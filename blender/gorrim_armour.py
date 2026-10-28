"""r25 Gorrim armour parts. Donor arrays remain read-only; run via tools/blender-run.mjs.

--preview [--only helm|jerkin|bracers|coif] --iter N writes owned parts and calls
the lead's preview assembler. No public assets, shared helpers, or rig edits.
"""
import argparse
import json
import math
import os
import shutil
import struct
import sys
import time
import zlib

import numpy as np
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gorrim_team as T
from lib import pipeline

CONFIG = {
    "seed": 2527,
    "out": os.path.join(T.PARTS_DIR, "armour"),
    "scratch": os.path.join(T.TEAM, "armour"),
    "band_width": .035,
    "band_rivets": 22,
    "cross_width": .018,
    "nose_width": .022,
    "nose_bottom": 1.225,
    "skirt_depth": .009,
    "horn_sides": 16,
    "horn_steps": 25,
    "jerkin_bottom": .728,
    "jerkin_top": 1.105,
    "jerkin_fit": .0012,
    "jerkin_thickness": .007,
    "bracer_ratio": 1.52,
    "uv_margin": 12,
    # sRGB authoring. Large iron/leather groups dark; small brass/ivory accents bright.
    "palette": {
        "iron": ((66, 75, 83), .54, .80),
        "brass": ((207, 151, 56), .38, .86),
        "horn": ((205, 190, 156), .63, 0),
        "leather": ((75, 44, 27), .83, 0),
        "edge": ((100, 62, 34), .74, 0),
        "mail": ((57, 65, 70), .64, .62),
        "fur": ((64, 45, 31), .91, 0),
    },
}
MAT_NAMES = list(CONFIG["palette"])
HORN_PATHS = []
BRACER_FRAMES = []


def log(s):
    print("[gorrim-armour] " + s, flush=True)


def norm(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def basis(n):
    n = norm(n)
    u = norm(np.cross(n, (0, 0, 1)))
    if np.linalg.norm(u) < .1:
        u = np.array((1., 0., 0.))
    return u, norm(np.cross(n, u))


def joint(arm, name):
    return np.array(arm.matrix_world @ arm.data.bones[name].head_local)


def mesh(name, P, F, mat, bevel=0, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(P).tolist(), [], F)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(bpy.data.materials["armour_" + mat])
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        b = ob.modifiers.new("Crafted edge bevel", "BEVEL")
        b.width, b.segments, b.limit_method = bevel, 1, "ANGLE"
        b.angle_limit = math.radians(38)
        b.miter_outer, b.harden_normals, b.use_clamp_overlap = "MITER_ARC", True, True
    w = ob.modifiers.new("Weighted hard surface normals", "WEIGHTED_NORMAL")
    w.keep_sharp = True
    return ob


def grid(name, P, mat, wrap=False, caps=False, bevel=0):
    P = np.asarray(P)
    nr, nc = P.shape[:2]
    F = []
    for i in range(nr - 1):
        for j in range(nc if wrap else nc - 1):
            k = (j + 1) % nc
            a, b, c, d = i * nc + j, i * nc + k, (i + 1) * nc + k, (i + 1) * nc + j
            F.append((a, b, c, d))
    if caps:
        F += [tuple(range(nc - 1, -1, -1)), tuple((nr - 1) * nc + j for j in range(nc))]
    return mesh(name, P.reshape(-1, 3), F, mat, bevel)


def ball(name, c, r, mat="brass", flatten=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=r, location=c)
    ob = bpy.context.object
    ob.name = name
    if flatten is not None:
        n, depth = flatten
        n = norm(n)
        for v in ob.data.vertices:
            q = np.array(v.co)
            v.co = q + n * np.dot(q, n) * (depth - 1)
    ob.data.materials.append(bpy.data.materials["armour_" + mat])
    for f in ob.data.polygons:
        f.use_smooth = True
    return ob


def tube(name, path, radii, mat, sides=12, caps=True):
    path = np.asarray(path)
    radii = np.broadcast_to(radii, (len(path),))
    P = []
    old_u = None
    closed = np.linalg.norm(path[0] - path[-1]) < 1e-7
    first_frame = None
    for i, c in enumerate(path):
        tangent = norm(path[1] - path[-2]) if closed and i in (0, len(path) - 1) else \
                  norm(path[min(len(path) - 1, i + 1)] - path[max(0, i - 1)])
        u, v = basis(tangent)
        if old_u is not None:
            u = norm(old_u - tangent * np.dot(old_u, tangent))
            v = norm(np.cross(tangent, u))
        if first_frame is None:
            first_frame = (u.copy(), v.copy())
        if closed and i == len(path) - 1:
            u, v = first_frame
        old_u = u
        P.append([c + radii[i] * (u * math.cos(a) + v * math.sin(a))
                  for a in np.linspace(0, 2 * math.pi, sides, endpoint=False)])
    return grid(name, P, mat, wrap=True, caps=caps and not closed)


def ribbon(name, path, normals, width, depth, mat, bevel=.0007):
    path, normals = np.asarray(path), np.asarray(normals)
    P = []
    for i, p in enumerate(path):
        tangent = norm(path[min(i + 1, len(path) - 1)] - path[max(0, i - 1)])
        n = norm(normals[i])
        side = norm(np.cross(tangent, n))
        P.append([p + side * w * width / 2 + n * h for w, h in
                  [(-1, 0), (-1, depth), (1, depth), (1, 0)]])
    return grid(name, P, mat, wrap=True, caps=True, bevel=bevel)


class Surface:
    def __init__(self, D, regions=("body", "mantle")):
        self.bvh = BVHTree.FromPolygons([Vector(p) for p in D.P], D.F[D.faces(*regions)].tolist(), all_triangles=True)

    def ray(self, p, d, offset=0):
        h, n, _, _ = self.bvh.ray_cast(Vector(p), Vector(d), 3)
        if h is None:
            raise RuntimeError("surface ray missed: " + str((np.asarray(p).tolist(), np.asarray(d).tolist())))
        return np.array(h) + np.array(n) * offset, np.array(n)

    def torso(self, x, z, front=True, offset=0):
        return self.ray((x, -.8 if front else .8, z), (0, 1 if front else -1, 0), offset)


def donor_rim(D):
    bk, pid = T.boundary_edges(D.F[~np.isin(D.region, ["helm"])], D.P)
    bd, _ = T.boundary_edges(D.F, D.P)
    new = set(map(tuple, bk)) - set(map(tuple, bd))
    ids = np.unique(np.asarray(sorted(new)).ravel())
    first = np.full(pid.max() + 1, -1)
    first[pid[::-1]] = np.arange(len(pid))[::-1]
    return D.P[first[ids]]


def build_helm(D):
    objects = []
    rim = donor_rim(D)
    # Regular forged cap; keep the ear recesses concave. A convex hull around
    # every cut vertex produced an unwanted flared wing across the temples.
    rings = []
    for t in [-.065] + list(np.linspace(0, math.pi / 2 - .06, 11)):
        r = math.cos(max(t, 0))
        row = []
        for a in np.linspace(0, 2 * math.pi, 48, endpoint=False):
            x, y = .112 * r * math.sin(a), .027 - .137 * r * math.cos(a)
            z = 1.244 - .43 * y + .140 * math.sin(t)
            row.append((x, y, z))
        rings.append(row)
    P = np.array(rings).reshape(-1, 3).tolist()
    top = len(P)
    P.append((0, .027, 1.244 - .43 * .027 + .140))
    F = [tuple(range(47, -1, -1))]
    for i in range(len(rings) - 1):
        for j in range(48):
            k = (j + 1) % 48
            F.append((i * 48 + j, i * 48 + k, (i + 1) * 48 + k, (i + 1) * 48 + j))
    for j in range(48):
        F.append(((len(rings) - 1) * 48 + j, (len(rings) - 1) * 48 + (j + 1) % 48, top))
    dome = mesh("forged_iron_dome", P, F, "iron", .0008)
    me = dome.data
    objects.append(dome)
    # Exact, narrow cut-edge returns reconstructed from the donor's first rim
    # row. These hide behind the new brim and preserve the original ear notches;
    # no old crown, band, ribs, rivets or horns survive.
    rimkeys = {tuple(p) for p in np.round(rim, 7)}
    helmfaces = D.faces("helm")
    rimfaces = [fi for fi in helmfaces if any(tuple(p) in rimkeys for p in np.round(D.P[D.F[fi]], 7))]
    returns = []
    for fi in rimfaces:
        tri = D.P[D.F[fi]].copy()
        pinned = np.array([tuple(p) in rimkeys for p in np.round(tri, 7)])
        anchor = tri[pinned].mean(0)
        tri[~pinned] = anchor + (tri[~pinned] - anchor) * .15
        returns.extend(tri)
    objects.append(mesh("buried_cut_edge_returns", returns,
                        np.arange(len(returns)).reshape(-1, 3).tolist(), "iron", recalc=False))
    verts = [v.co.copy() for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    hull_bvh = BVHTree.FromPolygons(verts, polys)
    center = np.array((0, .027, 1.247))

    def fit_dir(d):
        d = norm(d)
        h, n, _, _ = hull_bvh.ray_cast(Vector(center + d * .55), Vector(-d), 1.1)
        assert h is not None
        return np.array(h), np.array(n)

    # Brow band follows the dome in the tilted rim plane. The lowest front edge
    # is above the brows; the inner iron skirt remains behind them.
    bn = norm((0, .43, 1))
    side = np.array((1., 0., 0.))
    back = norm(np.cross(bn, side))
    bc = np.array((0, .027, 1.244 - .43 * .027)) + bn * CONFIG["band_width"] / 2

    def band_pt(a, h):
        d = side * math.sin(a) - back * math.cos(a)
        origin = bc + bn * h
        p, n, _, _ = hull_bvh.ray_cast(Vector(origin + d * .55), Vector(-d), 1.1)
        assert p is not None, (a, h)
        return np.array(p), np.array(n), d

    P = []
    for a in np.linspace(0, 2 * math.pi, 65):
        row = []
        for h, thick in [(-.5, -.0006), (-.5, .0048), (.5, .0048), (.5, -.0006)]:
            p, n, d = band_pt(a, h * CONFIG["band_width"])
            row.append(p + n * thick)
        P.append(row)
    objects.append(grid("brass_brow_band_35mm", P, "brass", wrap=True, caps=False, bevel=.00065))
    brow_bottom = float(np.min(np.array(P)[[0, 1, -2, -1], :, 2]))
    rivet_count = 0
    for i in range(CONFIG["band_rivets"]):
        a = (i + .5) * 2 * math.pi / CONFIG["band_rivets"]
        p, n, _ = band_pt(a, 0)
        objects.append(ball("brow_domed_rivet_%02d" % i, p + n * .0045, .0041, flatten=(n, .62)))
        rivet_count += 1

    # Two actual brass cross bands, individually fitted to the new iron dome.
    for which in ("fore_aft", "side_side"):
        path, ns = [], []
        angles = np.linspace(-1.23, 1.23, 21)
        for a in angles:
            d = (0, math.sin(a), math.cos(a)) if which == "fore_aft" else (math.sin(a), 0, math.cos(a))
            p, n = fit_dir(d)
            path.append(p - n * .0003)
            ns.append(n)
        objects.append(ribbon("cross_band_" + which, path, ns, CONFIG["cross_width"], .0038, "brass"))
        for i in (2, 6, 10, 14, 18):
            p, n = path[i], ns[i]
            objects.append(ball("cross_rivet", p + n * .0035, .0035, flatten=(n, .62)))
            rivet_count += 1

    face = Surface(D, ("face", "head_other"))
    guard, normals = [], []
    for z in np.linspace(1.319, CONFIG["nose_bottom"], 15):
        if z >= 1.291:
            h, n, _, _ = hull_bvh.ray_cast(Vector((0, -.5, z)), Vector((0, 1, 0)), 1)
            y = float(h.y) - .0044
        else:
            t = (1.291 - z) / (1.291 - CONFIG["nose_bottom"])
            y = -.1145 + .0245 * t
        guard.append((0, y, z))
        normals.append((0, -1, 0))
    objects.append(ribbon("nose_guard_22mm", guard, normals, CONFIG["nose_width"], .0035, "brass", .0008))
    inset = []
    guard = np.array(guard)
    for f in np.linspace(1, len(guard) - 2, 8):
        i = min(int(f), len(guard) - 2)
        p = guard[i] * (1 - f + i) + guard[i + 1] * (f - i)
        inset.append(p + (0, -.0033, 0))
    objects.append(ribbon("nasal_iron_inlay", inset, [(0, -1, 0)] * len(inset), .012, .0013, "iron", .00035))
    objects.append(ball("nasal_upper_rivet", np.array(guard[1]) + (0, -.006, 0), .0035, flatten=((0, -1, 0), .6)))
    rivet_count += 1

    tips, deltas = [], []
    for sign in (-1, 1):
        # Keep Sept horn tips exactly; craft a continuous sixteen-sided sweep.
        hp = D.P[D.verts_of("helm")]
        hp = hp[hp[:, 0] * sign > .15]
        target = hp[np.argmax(hp[:, 2])]
        cp = np.array([(sign * .098, .009, 1.289), (sign * .151, .005, 1.300),
                       (sign * .188, -.008, 1.327), (sign * .201, -.026, 1.373),
                       (sign * .190, -.048, 1.416), target])
        # Catmull-Rom interpolation, clamped endpoints.
        path = []
        for t in np.linspace(0, len(cp) - 1, CONFIG["horn_steps"]):
            j = min(int(t), len(cp) - 2)
            f = t - j
            a, b, c, d = cp[max(0, j - 1)], cp[j], cp[j + 1], cp[min(len(cp) - 1, j + 2)]
            path.append(.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f ** 3))
        path = np.asarray(path)
        t = np.linspace(0, 1, len(path))
        radius = .027 * (1 - t) ** .86 + .00065
        objects.append(tube("ivory_horn_" + str(sign), path, radius, "horn", sides=CONFIG["horn_sides"]))
        HORN_PATHS.append(path)
        tips.append(path[-1].tolist())
        deltas.append(float(np.linalg.norm(path[-1] - target) * 1000))
        # Broad brass socket wraps the buried root and overlaps the ivory sweep.
        socketpath = path[:5]
        socketr = radius[:5] + np.array((.0030, .0040, .0038, .0038, .0025))
        objects.append(tube("horn_socket_" + str(sign), socketpath, socketr, "brass", sides=16))
    report = {"nose_guard_width_mm": CONFIG["nose_width"] * 1000, "nose_guard_bottom_z": CONFIG["nose_bottom"],
              "nose_nostril_reference_z": 1.175, "nose_guard_gap_above_nostrils_mm": (CONFIG["nose_bottom"] - 1.175) * 1000,
              "brow_band_width_mm": CONFIG["band_width"] * 1000, "brow_band_rivets": CONFIG["band_rivets"],
              "rivet_count": rivet_count, "brim_above_brow_mm": (brow_bottom - D.P[D.verts_of("brows")][:, 2].max()) * 1000,
              "horn_tip_positions": tips, "horn_tip_delta_mm": max(deltas) + .65, "horn_centerline_tip_delta_mm": max(deltas), "horn_sides": CONFIG["horn_sides"],
              "inner_skirt_depth_mm": CONFIG["skirt_depth"] * 1000}
    return objects, report


def init_materials():
    for name in MAT_NAMES:
        m = bpy.data.materials.new("armour_" + name)
        m.diffuse_color = tuple(v / 255 for v in CONFIG["palette"][name][0]) + (1,)


def build_jerkin(D):
    """A closed leather vest with real thickness, fitted to the torso by radial rays.

    The inner face is 1.2 mm outside the mail; the outer face is seven mm farther
    out. Arm holes are shaped by the top-edge height, leaving both sleeves bare.
    """
    objects = []
    torso = Surface.__new__(Surface)
    faces = D.faces("body", "mantle", "face", "head_other", "helm")
    torso.bvh = BVHTree.FromPolygons([Vector(p) for p in D.P], D.F[faces].tolist(), all_triangles=True)
    nr, nc = 13, 48
    angles = np.linspace(0, 2 * math.pi, nc, endpoint=False)
    inner, outer, normals = [], [], []
    distances = []
    def top(a):
        return 1.105 + .035 * math.sin(2 * a) ** 2 - .235 * math.sin(a) ** 2
    def torso_hit(a, z):
        radial = np.array((math.sin(a), -math.cos(a), 0))
        c = np.array((0, 0, z))
        origin = c + radial * .85
        # Skip detached forearm intersections along side rays, retaining the
        # first ENTERING torso hit. Unlike cropping faces, this preserves a
        # closed source surface for the actual inside/outside measurement.
        for _ in range(18):
            h, sn, ix, _ = torso.bvh.ray_cast(Vector(origin), Vector(-radial), 2)
            if h is None:
                return None
            h, sn = np.array(h), np.array(sn)
            r = float(np.dot(h - c, radial))
            if r < .045:
                return None
            if r < .36 and np.dot(sn, radial) > .02:
                return h, sn, int(ix)
            origin = h - radial * .000002
        return None
    # Stop the vest where the retained mantle begins. The donor is a merged
    # SDF exterior: there is no hidden torso surface beneath its fur. Never fit
    # a leather panel over that fur, or accept a ray hitting the opposite side.
    tops = []
    for a in angles:
        radial = np.array((math.sin(a), -math.cos(a), 0))
        last = CONFIG["jerkin_bottom"]
        for z in np.linspace(CONFIG["jerkin_bottom"], top(a), 71):
            hit = torso_hit(a, z)
            if hit is None:
                break
            h, sn, ix = hit
            # Keep shoulder/back fur visible. Front mantle roots lie beneath
            # the required chest panels; the existing outer pauldrons remain.
            fur = D.region[faces[ix]] == "mantle"
            if fur and not math.cos(a) > .35:
                break
            last = float(z)
        tops.append(max(CONFIG["jerkin_bottom"] + .012, last - .0015))
    for _ in range(48):
        old = np.array(tops)
        tops = np.minimum(old, np.minimum(np.roll(old, 1), np.roll(old, -1)) + .035).tolist()
    for v in np.linspace(0, 1, nr):
        ri, ro, rn = [], [], []
        for j, a in enumerate(angles):
            z = CONFIG["jerkin_bottom"] * (1 - v) + tops[j] * v
            n = np.array((math.sin(a), -math.cos(a), 0))
            c = np.array((0, 0, z))
            hit = torso_hit(a, z)
            if hit is None:
                raise RuntimeError("no entering torso surface at " + str((a, z)))
            p, sn, _ = hit
            if np.dot(p - c, n) < .045:
                raise RuntimeError("jerkin ray crossed to the opposite side")
            ri.append(p + n * CONFIG["jerkin_fit"])
            ro.append(p + n * CONFIG["jerkin_fit"] + sn * CONFIG["jerkin_thickness"])
            rn.append(sn)
            distances.append(CONFIG["jerkin_fit"] * 1000)
        inner.append(ri)
        outer.append(ro)
        normals.append(rn)
    inner, outer, normals = np.array(inner), np.array(outer), np.array(normals)
    # Actual closed-volume parity, rather than the sign of a nearest open face.
    flat = inner.reshape(-1, 3)
    ray = norm((.237, .341, .909))
    inside = T._ray_parity(flat, D.P, D.F[faces], d=ray)
    for _ in range(4):
        if not inside.any():
            break
        for i in np.flatnonzero(inside):
            a = angles[i % nc]
            flat[i] += np.array((math.sin(a), -math.cos(a), 0)) * .0002
        inside = T._ray_parity(flat, D.P, D.F[faces], d=ray)
    assert not inside.any(), "vest has vertices inside the donor body"
    distances, signed = [], []
    for p in inner.reshape(-1, 3):
        h, n, _, gap = torso.bvh.find_nearest(Vector(p))
        distances.append(gap * 1000)
        signed.append(float(np.dot(p - np.array(h), np.array(n))))
    shell = np.concatenate([outer, inner[::-1], outer[:1]], axis=0)
    objects.append(grid("dark_leather_jerkin", shell, "leather", wrap=True))
    for i, label in ((0, "waist"), (-1, "collar_and_armholes")):
        path = np.concatenate([outer[i], outer[i, :1]])
        objects.append(tube("rolled_" + label, path, .0033, "edge", sides=5))
    # Front/back crossing straps are projected onto the fitted vest, not a
    # gradient-projected torso. Their bottom face overlaps the leather surface.
    surface = Surface.__new__(Surface)
    surface.bvh = BVHTree.FromPolygons([Vector(p) for p in outer.reshape(-1, 3)],
        [(i * nc + j, i * nc + (j + 1) % nc, (i + 1) * nc + (j + 1) % nc, (i + 1) * nc + j)
         for i in range(nr - 1) for j in range(nc)])
    straps = 0
    for front in (True, False):
        for sign in (-1, 1):
            path, ns = [], []
            for t in np.linspace(0, 1, 18):
                x = sign * (-.176 + .327 * t)
                z = .756 + .250 * t
                if front:
                    try:
                        p, n = surface.torso(x, z, True)
                    except RuntimeError:
                        # The front strap may climb onto the mantle shoulder.
                        p, n = torso.torso(x, z, True, .0012)
                else:
                    h, sn, fi, _ = torso.bvh.ray_cast(Vector((x, .8, z)), Vector((0, -1, 0)), 2)
                    if h is None:
                        raise RuntimeError("back strap ray missed")
                    n = np.array(sn)
                    offset = CONFIG["jerkin_fit"] if D.region[faces[fi]] == "mantle" else CONFIG["jerkin_fit"] + CONFIG["jerkin_thickness"]
                    p = np.array(h) + n * offset
                path.append(p - n * .0003)
                ns.append(n)
            objects.append(ribbon("leather_cross_strap", path, ns, .026, .0032, "edge", bevel=.0005))
            straps += 1
            for k in (2, 14):
                objects.append(ball("jerkin_strap_stud", path[k] + ns[k] * .0030, .004, flatten=(ns[k], .60)))
    report = {"fit_method": "outside-in BVH rays, limb faces excluded; rolled collar/armhole and waist edges",
              "inner_offset_mm": [float(np.mean(distances)), float(max(distances))],
              "inside_vertices": int(inside.sum()), "inside_test": "closed donor body ray parity; outward correction capped at 0.8mm",
              "thickness_mm": CONFIG["jerkin_thickness"] * 1000,
              "strap_count": straps, "donor_mantle": "retained; top edge follows exterior mantle where present",
              "coverage": "chest/back/flanks below retained mantle; open underarms, mail sleeves/skirt retained",
              "top_heights_m": tops}
    return objects, report


def build_bracers(D, arm):
    objects, measures = [], {}
    for side in ("L", "R"):
        c = joint(arm, "forearm_" + side)
        end = joint(arm, "hand_" + side)
        d = norm(end - c)
        length = float(np.linalg.norm(end - c))
        S = Surface.__new__(Surface)
        ids = D.faces("body")
        q = D.C[ids] - c
        along = q @ d
        radial = np.linalg.norm(q - along[:, None] * d, axis=1)
        ids = ids[(along > -.04) & (along < length + .035) & (radial < .16)]
        S.bvh = BVHTree.FromPolygons([Vector(p) for p in D.P], D.F[ids].tolist(), all_triangles=True)
        u = norm(np.array((0., -1., 0.)) - d * np.dot(d, (0, -1, 0)))
        v = norm(np.cross(d, u))
        ts = np.linspace(.026, length + .009, 5)
        angles = np.linspace(0, 2 * math.pi, 20, endpoint=False)
        inner, outer = [], []
        actual, ratios = [], []
        radii_rows = []
        for t in ts:
            rs = []
            for a in angles:
                n = u * math.cos(a) + v * math.sin(a)
                sample = min(t, length - .018)
                center = c + d * sample
                p, sn = S.ray(center + n * .42, -n)
                r = float(np.dot(p - center, n))
                rs.append(r)
            radii_rows.append(rs)
        reference_radius = float(np.median(np.array(radii_rows)[-2:]))
        surface_ratios = []
        for i, t in enumerate(ts):
            ri, ro = [], []
            for j, a in enumerate(angles):
                n = u * math.cos(a) + v * math.sin(a)
                r = radii_rows[i][j]
                # Existing proximal cuff/fur peaks are part of the preserved
                # donor. Enclose them, rather than multiplying their radius.
                radius = max(reference_radius * CONFIG["bracer_ratio"], max(radii_rows[i]) + .004)
                ri.append(c + d * t + n * (r + .0010))
                ro.append(c + d * t + n * radius)
                actual.append(r)
                ratios.append(radius / reference_radius)
                surface_ratios.append(radius / r)
            inner.append(ri)
            outer.append(ro)
        inner, outer = np.array(inner), np.array(outer)
        objects.append(grid("massive_leather_bracer_" + side,
                            np.concatenate([outer, inner[::-1], outer[:1]]), "leather", wrap=True))
        BRACER_FRAMES.append((c, d, u, v, length))
        # Brass bands sit on the actual outer cuff, including its wrist taper.
        for band_i in (1, len(ts) - 2):
            P = []
            for dt, lift in ((-.007, -.0004), (-.005, .0030), (.005, .0030), (.007, -.0004)):
                ring = []
                for j, a in enumerate(angles):
                    n = u * math.cos(a) + v * math.sin(a)
                    ring.append(outer[band_i, j] + d * dt + n * lift)
                P.append(ring)
            # Closed 4-point band section along a repeated circular perimeter.
            P = np.stack(P, axis=1)
            P = np.concatenate([P, P[:1]])
            objects.append(grid("brass_cuff_band_" + side, P, "brass", wrap=True, bevel=.0006))
        # Brass front panel lies flush on the middle of the cuff. A knot relief
        # is authored in tangent normal/albedo rather than extra tiny triangles.
        P = []
        for t in np.linspace(ts[1] + .011, ts[-2] - .011, 3):
            f = np.interp(t, ts, np.arange(len(ts)))
            i = min(int(f), len(ts) - 2)
            alpha = f - i
            row = []
            for a in np.linspace(-.55, .55, 5):
                n = u * math.cos(a) + v * math.sin(a)
                ar = (a % (2 * math.pi)) / (2 * math.pi) * len(angles)
                j = int(ar) % len(angles)
                beta = ar - int(ar)
                radial = ((1 - beta) * outer[i, j] + beta * outer[i, (j + 1) % len(angles)]) * (1 - alpha)
                radial += ((1 - beta) * outer[i + 1, j] + beta * outer[i + 1, (j + 1) % len(angles)]) * alpha
                row.append(radial + n * .0012)
            P.append(row)
        panel = np.array(P)
        # Thin closed plate; its underside penetrates the cuff by .3 mm.
        under = panel - u * .0015
        # Join corresponding edges without duplicating coincident faces.
        nr, nc = panel.shape[:2]
        pv = np.concatenate([panel.reshape(-1, 3), under.reshape(-1, 3)])
        F = []
        for layer in (0, nr * nc):
            for i in range(nr - 1):
                for j in range(nc - 1):
                    F.append(tuple(layer + x for x in (i * nc + j, i * nc + j + 1, (i + 1) * nc + j + 1, (i + 1) * nc + j)))
        boundary = list(range(nc)) + [i * nc + nc - 1 for i in range(1, nr)] + \
                   [(nr - 1) * nc + j for j in range(nc - 2, -1, -1)] + [i * nc for i in range(nr - 2, 0, -1)]
        for j, a in enumerate(boundary):
            b = boundary[(j + 1) % len(boundary)]
            F.append((a, b, b + nr * nc, a + nr * nc))
        objects.append(mesh("brass_knot_panel_" + side, pv, F, "brass", bevel=.0005))
        measures[side] = {"forearm_length_mm": length * 1000, "radius_ratio_min": min(ratios),
                          "donor_radius_mm": [min(actual) * 1000, max(actual) * 1000],
                          "forearm_reference_radius_mm": reference_radius * 1000,
                          "reference": "median distal half of donor forearm; proximal existing cuff peaks enclosed with 4mm clearance",
                          "donor_surface_radius_ratio_min": min(surface_ratios), "wrist_overlap_mm": 9}
    return objects, measures


def build_coif(D):
    """Dark mail side/back drape, starting beneath the brim, ending on mantle."""
    S = Surface(D, ("body", "mantle", "head_other", "face", "helm"))
    inner, outer = [], []
    misses = 0
    angles = np.linspace(.94, 2 * math.pi - .94, 43)
    bottoms = []
    for a in angles:
        top = 1.246 + .035 * math.cos(a)
        radial = np.array((math.sin(a), -math.cos(a), 0))
        last = top
        for z in np.linspace(top, 1.15, 61):
            c = np.array((0, .027, z))
            h, sn, ix, _ = S.bvh.ray_cast(Vector(c + radial * .65), Vector(-radial), 2)
            if h is None or not .025 < np.dot(np.array(h) - c, radial) < .165:
                break
            last = float(z)
        bottoms.append(min(top - .004, last))
    for t in np.linspace(0, 1, 9):
        ri, ro = [], []
        for j, a in enumerate(angles):
            top = 1.246 + .035 * math.cos(a)
            bottom = bottoms[j]
            z = top * (1 - t) + bottom * t
            n = np.array((math.sin(a), -math.cos(a), 0))
            c = np.array((0, .027, z))
            try:
                p, sn = S.ray(c + n * .65, -n)
            except RuntimeError:
                # Only the hidden top row can fall in the pre-existing cut.
                p, sn, _, _ = S.bvh.find_nearest(Vector(c + n * .115))
                p, sn = np.array(p), np.array(sn)
                misses += 1
            ri.append(p + sn * .0007)
            ro.append(p + sn * .0042)
        inner.append(ri)
        outer.append(ro)
    inner, outer = np.array(inner), np.array(outer)
    nr, nc = inner.shape[:2]
    P = np.concatenate([outer.reshape(-1, 3), inner.reshape(-1, 3)])
    F = []
    for off in (0, nr * nc):
        for i in range(nr - 1):
            for j in range(nc - 1):
                F.append(tuple(off + k for k in (i * nc + j, i * nc + j + 1, (i + 1) * nc + j + 1, (i + 1) * nc + j)))
    boundary = list(range(nc)) + [i * nc + nc - 1 for i in range(1, nr)] + \
               [(nr - 1) * nc + j for j in range(nc - 2, -1, -1)] + [i * nc for i in range(nr - 2, 0, -1)]
    for i, a in enumerate(boundary):
        b = boundary[(i + 1) % len(boundary)]
        F.append((a, b, b + nr * nc, a + nr * nc))
    objects = [mesh("mail_coif_drape", P, F, "mail")]
    # Short flattened fur fringe laid back along the retained mantle. Wide
    # buried roots, varied lengths, lens sections; no clumps or round spikes.
    fur = Surface(D, ("mantle",))
    rng = np.random.default_rng(CONFIG["seed"] + 21)
    lengths, widths = [], []
    for sign in (-1, 1):
        for k in range(6):
            y = -.100 + .039 * k
            z = 1.132 + .012 * math.sin(k * 1.7)
            try:
                root, rootn = fur.ray((sign * .8, y, z), (-sign, 0, 0))
            except RuntimeError:
                continue
            length = float(rng.uniform(.032, .064))
            width = float(rng.uniform(.021, .038))
            flow = norm((sign * .10, .25, -.96))
            # The side ray projects along X, so width must span YZ. Projecting
            # an X-heavy lateral vector collapsed columns onto the same point.
            cross = norm((0, -flow[2], flow[1]))
            patch = []
            for it, t in enumerate(np.linspace(0, 1, 7)):
                center = root + flow * length * t
                row = []
                for s in np.linspace(-1, 1, 5):
                    q = center + cross * s * width * .5 * max(.035, (1 - t) ** .72)
                    try:
                        p, n = fur.ray((sign * .8, q[1], q[2]), (-sign, 0, 0))
                    except RuntimeError:
                        p, n = q, rootn
                    lift = -.003 if it == 0 else .0012 + .003 * (1 - s * s) * math.sin(math.pi * t)
                    row.append(p + n * lift)
                patch.append(row)
            objects.append(grid("shoulder_fur_trim", patch, "fur"))
            lengths.append(length * 1000)
            widths.append(width * 1000)
    return objects, {"thickness_mm": 3.5, "front_open_angle_deg": math.degrees(1.88),
                  "attachment": "BVH fit over temples/neck/shoulder mantle; top under brim; front centre open for beard",
                  "ray_fallbacks": misses, "fur_trim_count": len(lengths),
                  "fur_trim_length_mm": [min(lengths), max(lengths)] if lengths else [],
                  "fur_trim_width_mm": [min(widths), max(widths)] if widths else [], "fur_root_burial_mm": 3}


def join_and_unwrap(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        for mod in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = "armour_" + name
    # Unwrap each connected curved patch with angle-limited projections; preserve
    # physical relative scale when packing, with twelve pixels of tile padding.
    pipeline.smart_project_faces(ob, np.ones(len(ob.data.polygons), bool), angle=55)
    pipeline.pack_atlas_skyline([ob], margin_px=CONFIG["uv_margin"], res=1024)
    tri = ob.modifiers.new("Export triangles", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri.name)
    ob.data.update()
    return ob


def arrays(ob):
    me = ob.data
    me.calc_loop_triangles()
    P = np.array([v.co[:] for v in me.vertices], float)
    F = np.array([list(p.vertices) for p in me.polygons], np.int32)
    UV = np.array([x.uv[:] for x in me.uv_layers.active.data]).reshape(-1, 3, 2)
    N = np.array([n.vector[:] for n in me.corner_normals]).reshape(-1, 3, 3)
    N /= np.maximum(np.linalg.norm(N, axis=2, keepdims=True), 1e-12)
    mats = [s.name.removeprefix("armour_") for s in me.materials]
    tags = np.array([MAT_NAMES.index(mats[p.material_index]) for p in me.polygons])
    return P, F, UV, N, tags


def clean_arrays(P, F, UV, N, tags):
    area = .5 * np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    pos_id = np.unique(np.round(P, 7), axis=0, return_inverse=True)[1].ravel()
    _, first = np.unique(np.sort(pos_id[F], axis=1), axis=0, return_index=True)
    keep = np.zeros(len(F), bool)
    keep[first] = True
    keep &= area >= T.CONFIG["cleanup"]["degenerate_area"]
    return P, F[keep], UV[keep], N[keep], tags[keep]


def png(path, data):
    arr = np.clip(np.round(data * 255), 0, 255).astype(np.uint8)[::-1]
    h, w, c = arr.shape
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\0" + r.tobytes() for r in arr)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2 if c == 3 else 6, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def shade(P, tag):
    name = MAT_NAMES[tag]
    rgb, rough, metal = CONFIG["palette"][name]
    x, y, z = P.T
    grain = np.sin(x * 1279 + y * 811 + z * 1511) * np.sin(x * 571 - y * 1987 + z * 733)
    broad = np.sin(x * 59 + z * 43) * np.cos(y * 67 - z * 29)
    value = .96 + .04 * broad + .016 * grain
    H = grain * .000035
    if name == "horn" and HORN_PATHS:
        # World-space rings follow the curved horn centreline, independent of UV seams.
        starts = np.concatenate([path[:-1] for path in HORN_PATHS])
        edges = np.concatenate([np.diff(path, axis=0) for path in HORN_PATHS])
        rel = P[:, None] - starts[None]
        along = np.clip((rel * edges[None]).sum(2) / (edges * edges).sum(1)[None], 0, 1)
        dist = ((rel - along[:, :, None] * edges[None]) ** 2).sum(2)
        ix = dist.argmin(1)
        t = ((ix % (CONFIG["horn_steps"] - 1)) + along[np.arange(len(P)), ix]) / (CONFIG["horn_steps"] - 1)
        ring = np.sin(t * math.pi * 39 + .24 * np.sin(y * 303))
        value *= 1 - .61 * np.clip((t - .52) / .48, 0, 1) ** 1.4
        value *= 1 + .035 * ring
        H += .00022 * ring + .00007 * np.sin(x * 1191 + y * 1703)
    if name in ("leather", "edge"):
        value *= 1 + .06 * np.sin(x * 43 + y * 35 + z * 27)
        H += .00006 * grain
    if name == "mail":
        # Interlocking staggered elliptical rings, shaded into the dark steel.
        azimuth = np.arctan2(x, -(y - .027))
        row = np.floor(z / .006)
        U = ((azimuth * .15 / .007) + .5 * (row % 2)) % 1 - .5
        V = (z / .006) % 1 - .5
        rr = np.sqrt((U / .44) ** 2 + (V / .37) ** 2)
        ring = np.exp(-((rr - 1) / .16) ** 2)
        value *= .58 + .65 * ring
        H += ring * .00042
    if name == "fur":
        strand = np.sin(x * 1137 - y * 621 + .5 * np.sin(z * 70))
        value *= .94 + .075 * strand
        H += strand * .00010
    if name == "brass":
        value *= 1 + .03 * np.sin(z * 580 + x * 363)
        H += .000025 * np.sin(x * 1753 + y * 2243)
        for c, d, u, v, length in BRACER_FRAMES:
            q = P - c
            t = q @ d
            mid = (.026 + length + .009) / 2
            half = max(.008, (length + .009 - .026) / 4 - .011)
            X, Y = (q @ v) / .045, (t - mid) / half
            panel = (np.abs(X) < 1.04) & (np.abs(Y) < 1.04) & (q @ u > .045)
            knot = np.zeros(len(P))
            for phase in (0, 2 * math.pi / 3, 4 * math.pi / 3):
                strand = .69 * np.sin(X * math.pi * .85 + phase)
                knot = np.maximum(knot, np.exp(-((Y - strand) / .075) ** 2))
            border = np.exp(-((np.maximum(np.abs(X), np.abs(Y)) - .94) / .045) ** 2)
            knot = np.maximum(knot, border)
            value[panel] *= .58 + .55 * knot[panel]
            H[panel] += knot[panel] * .00065
    A = np.clip(np.array(rgb)[None] / 255 * value[:, None], 0, 1)
    O = np.tile((.97, rough, metal), (len(P), 1))
    O[:, 1] += .025 * broad
    return A, O, H


def paint_tile(tile, P, F, UV, tags):
    res = 1024
    A = np.zeros((res, res, 3), np.float32)
    O = np.zeros_like(A)
    H = np.zeros((res, res), np.float32)
    mask = np.zeros((res, res), bool)
    densities = []
    for fi, (f, U) in enumerate(zip(F, UV)):
        uv = U * res
        low = np.maximum(np.floor(uv.min(0)).astype(int), 0)
        high = np.minimum(np.ceil(uv.max(0)).astype(int), res - 1)
        if (high < low).any():
            continue
        yy, xx = np.mgrid[low[1]:high[1] + 1, low[0]:high[0] + 1]
        q = np.stack([xx + .5, yy + .5], -1).reshape(-1, 2)
        a, b, c = uv
        det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(det) < 1e-10:
            continue
        w1 = ((q[:, 0] - a[0]) * (c[1] - a[1]) - (q[:, 1] - a[1]) * (c[0] - a[0])) / det
        w2 = ((b[0] - a[0]) * (q[:, 1] - a[1]) - (b[1] - a[1]) * (q[:, 0] - a[0])) / det
        bc = np.stack([1 - w1 - w2, w1, w2], 1)
        inside = (bc >= -1e-6).all(1)
        if not inside.any():
            continue
        world = bc[inside] @ P[f]
        aa, oo, hh = shade(world, int(tags[fi]))
        iy, ix = yy.ravel()[inside], xx.ravel()[inside]
        A[iy, ix], O[iy, ix], H[iy, ix], mask[iy, ix] = aa, oo, hh, True
        a3 = np.linalg.norm(np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]]))
        densities.append(math.sqrt(abs(det) / max(a3, 1e-12)))
    original = mask.copy()
    # Propagate colour/ORM/height sixteen pixels under empty texels; never dark rims.
    for _ in range(16):
        old = mask.copy()
        for axis, step in ((0, 1), (1, 1), (0, -1), (1, -1)):
            source = np.roll(old, step, axis)
            take = ~mask & source
            for arr in (A, O, H):
                arr[take] = np.roll(arr, step, axis)[take]
            mask[take] = True
    dy, dx = np.gradient(H)
    td = float(np.median(densities))
    V = np.stack([-dx * td, -dy * td, np.ones_like(dx)], -1)
    V /= np.linalg.norm(V, axis=2, keepdims=True)
    N = V * .5 + .5
    A[~mask] = np.array(CONFIG["palette"]["leather"][0]) / 255
    O[~mask] = (1, .8, 0)
    N[~mask] = (.5, .5, 1)
    out = os.path.join(CONFIG["out"], "tiles")
    os.makedirs(out, exist_ok=True)
    for k, arr in (("albedo", A), ("orm", O), ("normal", N)):
        png(os.path.join(out, tile + "_" + k + ".png"), arr)
    return {"coverage": float(original.mean()), "median_texels_per_m": td, "dilation_px": 16}


def weights_for(name, P, F, D):
    if name == "helm":
        W = np.zeros((len(P), len(D.bones)))
        W[:, D.bones.index("head")] = 1
    elif name == "bracers":
        W = np.zeros((len(P), len(D.bones)))
        for side, sign in (("L", 1), ("R", -1)):
            sel = P[:, 0] * sign > 0
            c, d, u, v, length = BRACER_FRAMES[0 if side == "L" else 1]
            t = (P[sel] - c) @ d
            hand = np.clip((t - length + .012) / .022, 0, 1) * .28
            W[sel, D.bones.index("forearm_" + side)] = 1 - hand
            W[sel, D.bones.index("hand_" + side)] = hand
    else:
        allowed = ["head", "neck", "chest", "clavicle_L", "clavicle_R"] if name == "coif" else ["chest", "spine", "clavicle_L", "clavicle_R"]
        regions = ("body", "mantle", "head_other", "face", "helm") if name == "coif" else ("body", "mantle")
        W, _ = T.transfer_weights(P, D, regions=regions, bones=allowed)
        edges = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        edges = np.concatenate([edges, edges[:, ::-1]])
        count = np.maximum(np.bincount(edges[:, 0], minlength=len(P)), 1)
        for _ in range(3):
            accum = np.zeros_like(W)
            np.add.at(accum, edges[:, 0], W[edges[:, 1]])
            W = .70 * W + .30 * accum / count[:, None]
        empty = W.sum(1) < 1e-6
        W[empty, D.bones.index("chest")] = 1
        W /= W.sum(1, keepdims=True)
    return W


def save_geometry(name, tile, objects, D, replaces, report):
    ob = join_and_unwrap(objects, name)
    P, F, UV, N, tags = clean_arrays(*arrays(ob))
    assert len(F) <= T.CONFIG["budget"][name], (name, len(F))
    W = weights_for(name, P, F, D)
    report["texture"] = paint_tile(tile, P, F, UV, tags)
    report["tris"] = int(len(F))
    T.save_part(CONFIG["out"], name, P=P, F=F, UV=UV, N=N, W=W, bones=D.bones, tile=tile,
                meta={"role": "armour", "replaces": replaces, "author": "GPT-6.1 Sol", "notes": report})
    bpy.data.objects.remove(ob, do_unlink=True)
    return report


def save_shared_armour(parts, D):
    """Bracers and coif share one non-overlapping physical-density atlas."""
    objects = []
    for name, (obs, report) in parts.items():
        for ob in obs:
            group = ob.vertex_groups.new(name="owned_" + name)
            group.add(list(range(len(ob.data.vertices))), 1, "REPLACE")
            objects.append(ob)
    ob = join_and_unwrap(objects, "mail_and_bracers")
    P, F, UV, N, tags = clean_arrays(*arrays(ob))
    texture = paint_tile("armour", P, F, UV, tags)
    result = {}
    for name, (obs, report) in parts.items():
        gid = ob.vertex_groups["owned_" + name].index
        owns = np.array([any(g.group == gid and g.weight > .5 for g in v.groups) for v in ob.data.vertices])
        sel = np.flatnonzero(owns[F].all(1))
        used = np.unique(F[sel])
        rm = np.full(len(P), -1, int)
        rm[used] = np.arange(len(used))
        p, f = P[used], rm[F[sel]]
        assert len(f) <= T.CONFIG["budget"][name], (name, len(f))
        W = weights_for(name, p, f, D)
        report.update(texture=texture, tris=int(len(f)), shared_tile="armour")
        T.save_part(CONFIG["out"], name, P=p, F=f, UV=UV[sel], N=N[sel], W=W, bones=D.bones, tile="armour",
                    meta={"role": "armour", "replaces": [], "author": "GPT-6.1 Sol", "notes": report})
        result[name] = report
    bpy.data.objects.remove(ob, do_unlink=True)
    return result


def restore_preview_donor(path):
    """Opt-in workaround for the shared export's normal/weight round trip.

    Source data comes from original GLB accessors, not Blender's armature groups.
    P+UV identify donor corners; joint indices are remapped by exact bone names.
    """
    ct = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    def read(p):
        raw = bytearray(open(p, "rb").read())
        n = struct.unpack_from("<I", raw, 12)[0]
        g = json.loads(raw[20:20 + n])
        start = 28 + n
        def acc(i):
            a = g["accessors"][i]
            b = g["bufferViews"][a["bufferView"]]
            dt, count = ct[a["componentType"]], nc[a["type"]]
            offset = start + b.get("byteOffset", 0) + a.get("byteOffset", 0)
            stride = b.get("byteStride", np.dtype(dt).itemsize * count)
            return np.ndarray((a["count"], count), dtype=dt, buffer=raw, offset=offset,
                              strides=(stride, np.dtype(dt).itemsize))
        return raw, g, acc
    source, donor, source_acc = read(T.DONOR_GLB)
    raw, g, acc = read(path)
    da = donor["meshes"][0]["primitives"][0]["attributes"]
    oldbones = [donor["nodes"][j]["name"] for j in donor["skins"][0]["joints"]]
    bones = [g["nodes"][j]["name"] for j in g["skins"][0]["joints"]]
    lookup = {}
    for i, k in enumerate(np.round(np.c_[source_acc(da["POSITION"]), source_acc(da["TEXCOORD_0"])], 6)):
        lookup.setdefault(tuple(k), []).append(i)
    done = 0
    for me in g["meshes"]:
        for pr in me["primitives"]:
            if g["materials"][pr.get("material", 0)]["name"] != "M_hero_gorrim":
                continue
            at = pr["attributes"]
            outN = acc(at["NORMAL"])
            idx = []
            for i, k in enumerate(np.round(np.c_[acc(at["POSITION"]), acc(at["TEXCOORD_0"])], 6)):
                candidates = lookup.get(tuple(k))
                if not candidates:
                    raise RuntimeError("unmatched retained donor vertex " + str(k))
                idx.append(min(candidates, key=lambda j: np.linalg.norm(source_acc(da["NORMAL"])[j] - outN[i])))
            idx = np.array(idx, int)
            for key in ("NORMAL", "TANGENT", "JOINTS_0", "WEIGHTS_0"):
                if key not in at or key not in da:
                    continue
                values = source_acc(da[key])[idx].copy()
                if key == "JOINTS_0":
                    values = np.array([bones.index(oldbones[j]) for j in values.ravel()]).reshape(values.shape)
                acc(at[key])[:] = values
            done += len(idx)
    with open(path, "wb") as f:
        f.write(raw)
    report = {"restored_donor_vertices": done, "attributes": ["NORMAL", "TANGENT", "JOINTS_0", "WEIGHTS_0"],
              "method": "P+UV identity, named joint remap; original donor accessor values restored after Blender export"}
    T.save_json(os.path.join(os.path.dirname(path), "restored_donor.json"), report)
    return report


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--iter", type=int, default=1)
    ap.add_argument("--only", default="helm,jerkin,bracers,coif")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.out:
        CONFIG["out"] = os.path.abspath(a.out)
    snapshot = os.path.join(CONFIG["scratch"], "parts_snapshots", "pre_iter_%d" % a.iter)
    if os.path.isdir(CONFIG["out"]) and not os.path.exists(snapshot):
        os.makedirs(os.path.dirname(snapshot), exist_ok=True)
        shutil.copytree(CONFIG["out"], snapshot)
    start = time.time()
    D = T.Donor()
    arm = T.import_armature(T.DONOR_GLB)
    init_materials()
    report = {"config": CONFIG, "donor_sha": T.DONOR_SHA, "iter": a.iter, "parts": {}}
    log("stage donor done in %.1fs" % (time.time() - start))
    if "helm" in a.only.split(","):
        objects, r = build_helm(D)
        report["parts"]["helm"] = save_geometry("helm", "helm", objects, D, ["helm"], r)
        log("stage helm done in %.1fs" % (time.time() - start))
    if "jerkin" in a.only.split(","):
        objects, r = build_jerkin(D)
        report["parts"]["jerkin"] = save_geometry("jerkin", "jerkin", objects, D, [], r)
        log("stage jerkin done in %.1fs" % (time.time() - start))
    if set(a.only.split(",")) & {"bracers", "coif"}:
        parts = {}
        # Rebuild together if either already exists, since the tile is shared.
        both = any(os.path.exists(os.path.join(CONFIG["out"], n + ".npz")) for n in ("bracers", "coif"))
        for name in ("bracers", "coif"):
            if both or name in a.only.split(","):
                parts[name] = build_bracers(D, arm) if name == "bracers" else build_coif(D)
        report["parts"].update(save_shared_armour(parts, D))
        log("stage bracers/coif done in %.1fs" % (time.time() - start))
    audit = T.audit_role(CONFIG["out"])
    report["audit"] = audit
    report["seconds"] = time.time() - start
    T.save_json(os.path.join(CONFIG["scratch"], "build_report_%d.json" % a.iter), report)
    log(json.dumps(audit))
    assert audit["ok"], "part audit failed"
    if a.preview:
        import build_hero_gorrim_team as preview
        old = sys.argv
        sys.argv = [preview.__file__, "--", "--preview-role", "armour", "--out",
                    os.path.join(CONFIG["scratch"], "preview", str(a.iter))]
        try:
            preview.main()
            # Local workaround for the shared Blender export's <.001 weight
            # cutoff and normal quantisation. Keep all retained donor attributes.
            log("restored donor: " + json.dumps(restore_preview_donor(os.path.join(CONFIG["scratch"], "preview", str(a.iter), "hero_gorrim.glb"))))
        finally:
            sys.argv = old


if __name__ == "__main__":
    main()
