"""Shared character-build helpers (added by enemies-art-1; additive -- nothing else in blender/lib changed).

Generic pieces lifted from blender/build_hero_gorrim.py / build_hero_seraphine.py r2 so enemy scripts don't fork
them again: surface ray hits, geometry QA (loose islands, holes, flipped edges), UV fold repair, contract-rig UV
regions, kilt spring-chain helpers (cosine partition between chains), wrist/head override masks, AO composite,
clay preview helpers, rigid (single-bone) binding and per-variant texture export.
"""
import os
import json
import math
import numpy as np
import bpy

from . import sdf, meshutil, pipeline, skin, preview, hair
from .sdf import V, norm, Func, Inter, HalfSpace


# ----------------------------------------------------------------------------- sculpt helpers
def ray_hit(S, c, d, r_max=0.4):
    """First exit of the ray c + t d from an interior point c (= a point ON the surface, never floating)."""
    d = norm(V(d))
    t = hair.scalp_radius(S, V(c), d[None], r_max=r_max)[0]
    return V(c) + d * t


def surface_ring(S, c, z, r, n=64, nz=0.3):
    """ring_fn(a) of points projected onto sculpt S around a vertical axis at height z (a=0 front, -Y)."""
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    raw = np.array([V(c[0] + math.sin(a) * r, c[1] - math.cos(a) * r, z) for a in ang])
    P = S.project(raw, offset=0.0)
    P[:, 2] = z
    P = S.project(P, offset=0.0)
    N = S.grad(P)
    N[:, 2] *= nz
    N = N / np.linalg.norm(N, axis=1, keepdims=True)

    def fn(a):
        f = (a % (2 * math.pi)) / (2 * math.pi) * n
        i0 = int(f) % n
        i1 = (i0 + 1) % n
        t = f - int(f)
        return P[i0] * (1 - t) + P[i1] * t, norm(N[i0] * (1 - t) + N[i1] * t)
    return fn


def funnel_cutter(c, r0, s, lo_pad=0.35, zlo=-0.2, zhi=0.4, sy=1.1):
    """Upward-widening funnel around a vertical axis through c (steep cut angle vs a torso = clean necklines)."""
    cx, cy, z0 = float(c[0]), float(c[1]), float(c[2])
    k = 1.0 / math.sqrt(1.0 + s * s)

    def fn(X, Y, Z):
        r = np.sqrt((X - cx) ** 2 + ((Y - cy) * sy) ** 2)
        return (r - r0 - (Z - z0) * s) * k
    return Func(fn, V(cx - lo_pad, cy - lo_pad, z0 + zlo), V(cx + lo_pad, cy + lo_pad, z0 + zhi))


# ----------------------------------------------------------------------------- geometry QA
def geom_qa(ob):
    """Loose components, boundary edges (holes), non-manifold / inconsistently wound edges, degenerate faces,
    signed volume, and whether mesh.validate() had to repair anything (Seraphine r2 port)."""
    me = ob.data
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    lf = np.repeat(np.arange(len(ls)), lt)
    nxt = np.arange(len(lv)) + 1
    last = np.zeros(len(lv), bool)
    last[ls + lt - 1] = True
    nxt[last] = ls[lf[last]]
    a, b = lv, lv[nxt]
    key = np.minimum(a, b).astype(np.int64) * (1 << 32) + np.maximum(a, b)
    u, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    fwd = np.bincount(inv, weights=(a < b).astype(float), minlength=len(u))
    manifold = cnt == 2
    flipped = int((manifold & ((fwd == 0) | (fwd == 2))).sum())
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tri = lt == 3
    T = lv[np.stack([ls, ls + 1, ls + 2], 1)[tri]]
    P0, P1, P2 = co[T[:, 0]], co[T[:, 1]], co[T[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(P1 - P0, P2 - P0), axis=1)
    vol = float(np.einsum("ij,ij->i", P0, np.cross(P1, P2)).sum() / 6.0)
    E = np.stack([a, b], 1)
    lab = _components(E, len(me.vertices))
    used = np.unique(lv)
    comps, ccnt = np.unique(lab[used], return_counts=True)
    me2 = me.copy()
    repaired = bool(me2.validate(verbose=False))
    bpy.data.meshes.remove(me2)
    r = dict(components=int(len(comps)), smallest_component_verts=int(ccnt.min()) if len(ccnt) else 0,
             boundary_edges=int((cnt == 1).sum()), nonmanifold_edges=int((cnt > 2).sum()), flipped_edges=flipped,
             degenerate_faces=int((area < 1e-10).sum()), signed_volume_m3=round(vol, 5), validate_repaired=repaired)
    pipeline.log(f"geom QA {ob.name}: " + json.dumps(r))
    return r


def _components(E, nv):
    lab = np.arange(nv)
    for _ in range(4000):
        m = np.minimum(lab[E[:, 0]], lab[E[:, 1]])
        new = lab.copy()
        np.minimum.at(new, E[:, 0], m)
        np.minimum.at(new, E[:, 1], m)
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    return lab


def drop_islands(ob, h, min_verts=64):
    """Delete loose mesh islands smaller than min_verts (scaled to the polygonize step h vs 3.6 mm)."""
    import bmesh
    me = ob.data
    nv = len(me.vertices)
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    lab = _components(e.reshape(-1, 2), nv)
    u, inv, cnt = np.unique(lab, return_inverse=True, return_counts=True)
    thr = max(8, int(min_verts * (0.0036 / h) ** 2))
    kill = cnt[inv] < thr
    n_isl = int((cnt < thr).sum())
    if n_isl:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(kill)[0]], context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
    pipeline.log(f"{ob.name}: dropped {n_isl} islands < {thr} verts ({int(kill.sum())} verts); "
                 f"{len(u) - n_isl} components kept")
    return n_isl


def keep_largest(ob):
    """Keep only the largest connected component (rigid gear pieces must be one closed shell)."""
    import bmesh
    me = ob.data
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    lab = _components(e.reshape(-1, 2), len(me.vertices))
    u, inv, cnt = np.unique(lab, return_inverse=True, return_counts=True)
    if len(u) <= 1:
        return 0
    kill = inv != int(np.argmax(cnt))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(kill)[0]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return int(kill.sum())


# ----------------------------------------------------------------------------- UV
def uv_overlap_faces(ob, freg=None, res=1024, min_dist=0.03):
    """Faces whose UVs land on the same texel as a face >= min_dist away in 3D (folded charts)."""
    me = ob.data
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nf = len(ls)
    T = np.stack([ls, ls + 1, ls + 2], 1)
    U = uv[T]
    C = co[lv[T]].mean(1)
    bs = np.array([(a, b, 1 - a - b) for a in np.linspace(0.05, 0.9, 5) for b in np.linspace(0.05, 0.9 - a, 3)])
    groups = [np.arange(nf)] if freg is None else [np.nonzero(freg == r)[0] for r in np.unique(freg)]
    bad = np.zeros(nf, bool)
    for g in groups:
        if len(g) < 2:
            continue
        Ug = U[g]
        lo = Ug.reshape(-1, 2).min(0)
        span = max(float((Ug.reshape(-1, 2).max(0) - lo).max()), 1e-9)
        R = res if freg is None else 512
        px = np.einsum("sk,fkd->fsd", bs, (Ug - lo) / span)
        ij = np.clip((px * R).astype(np.int64), 0, R - 1)
        key = (ij[..., 1] * R + ij[..., 0]).reshape(-1)
        fid = np.repeat(g, len(bs))
        o = np.argsort(key, kind="stable")
        k2, f2 = key[o], fid[o]
        first = np.r_[True, k2[1:] != k2[:-1]]
        f0 = f2[first][np.cumsum(first) - 1]
        far = np.linalg.norm(C[f2] - C[f0], axis=1) > min_dist
        bad[f2[far]] = True
        bad[f0[far]] = True
    return bad


def fix_uv_overlaps(ob, freg, cfg):
    isl, _ = pipeline.uv_islands(ob)
    ls = np.empty(len(ob.data.polygons), np.int32)
    ob.data.polygons.foreach_get("loop_start", ls)
    bad = uv_overlap_faces(ob, isl[ls])
    if not bad.any():
        return 0
    me = ob.data
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    T = lv[np.stack([ls, ls + 1, ls + 2], 1)]
    vb = np.zeros(len(me.vertices), bool)
    vb[T[bad].reshape(-1)] = True
    ring = vb[T].any(1)
    n = 0
    for r in np.unique(freg[ring]):
        m = ring & (freg == r)
        pipeline.smart_project_faces(ob, m, angle=60.0)
        pipeline.normalize_density(ob, m, cfg.get(int(r), {}).get("density", 1.0))
        n += int(m.sum())
    pipeline.log(f"{ob.name}: re-charted {n} folded faces ({int(bad.sum())} overlapping)")
    return n


def uv_regions(arm, names, head_density=1.6):
    M = np.array(arm.matrix_world)
    cfg = {}
    for i, nm in enumerate(names):
        b = arm.data.bones[nm]
        h = M[:3, :3] @ np.array(b.head_local) + M[:3, 3]
        t = M[:3, :3] @ np.array(b.tail_local) + M[:3, 3]
        sx = 1.0 if nm.endswith("_L") else -1.0
        ref, dens, axis, halves = None, 1.0, (h, t), False
        if nm in ("hips", "spine", "chest", "neck"):
            axis, ref, halves = (V(0, 0, h[2]), V(0, 0, t[2])), V(1, 0, 0), True
        elif nm == "head":
            axis, ref, dens, halves = (V(0, 0.01, h[2]), V(0, 0.01, t[2])), V(1, 0, 0), head_density, True
        elif nm.startswith(("upperarm", "forearm")):
            a = math.radians(40)
            ref = V(-sx * math.sin(a), 0.15, -math.cos(a))
        elif nm.startswith(("thigh", "shin")):
            ref = V(-sx, 0.35, 0)
        elif nm.startswith(("foot", "toe")):
            ref = V(0, 0, -1)
        cfg[i] = dict(axis=axis, ref=ref, density=dens, halves=halves)
    return cfg


def body_unwrap(body_lo, arm, body_W, H, face_density=2.6, head_density=1.2, face_box=(-0.012, -0.16, 0.035)):
    """Artist-style charts by dominant bone + a separate dense face chart (Gorrim build block)."""
    names, W = body_W
    vdom = np.argmax(W, axis=1)
    me = body_lo.data
    ls = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    fl = np.stack([vdom[lv[ls + k]] for k in range(3)], axis=1)
    freg = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
    adj = pipeline.face_adjacency(body_lo)
    freg = pipeline.clean_labels(freg, adj, iters=3)
    cfg = uv_regions(arm, names)
    hid = names.index("head")
    Cf = pipeline.face_centers(body_lo)
    face_id = len(names)
    fy, fz0, fz1 = face_box
    freg = np.where((freg == hid) & (Cf[:, 1] < H(0, fy, 0)[1]) & (Cf[:, 2] > H(0, 0, fz0)[2]) &
                    (Cf[:, 2] < H(0, 0, fz1)[2]), face_id, freg)
    freg = pipeline.clean_labels(freg, adj, iters=2)
    cfg[face_id] = dict(axis=None, ref=None, density=face_density)
    cfg[hid].update(density=head_density, ref=V(0, 1, 0), halves=False)
    pipeline.region_unwrap(body_lo, freg, cfg)
    return sum(fix_uv_overlaps(body_lo, freg, cfg) for _ in range(3))


def fix_degenerate_uvs(ob, res, min_px=0.25):
    """enemies-art-1 C2 r9 (additive): faces whose UV triangle collapsed to (almost) a point after unwrap / pack
    (decimation needles at a nose tip) show ONE texel of whatever island lies there (the green thief's nose 'shard').
    Each such face takes the UV mapping of its best valid edge-neighbour, continued affinely (least-squares 3D -> UV of
    the neighbour's triangle), so it samples the neighbour's own texels. Returns the number of faces fixed."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    if uvl is None:
        bm.free()
        return 0

    def uv_area(f):
        u = [l[uvl].uv for l in f.loops]
        a = 0.0
        for i in range(1, len(u) - 1):
            a += (u[i][0] - u[0][0]) * (u[i + 1][1] - u[0][1]) - (u[i + 1][0] - u[0][0]) * (u[i][1] - u[0][1])
        return abs(a) * 0.5 * res * res

    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    bad = {f for f in bm.faces if uv_area(f) < min_px and f.calc_area() > 1e-9}
    fixed = 0
    updates = []
    for f in bad:
        best, best_a = None, 0.0
        for e in f.edges:
            for g in e.link_faces:
                if g is f or g in bad or len(g.loops) != 3:
                    continue
                a = uv_area(g)
                if a > best_a:
                    best, best_a = g, a
        if best is None:
            continue
        A, B, C = (np.array(l.vert.co) for l in best.loops)
        a, b, c = (np.array(l[uvl].uv) for l in best.loops)
        M = np.stack([B - A, C - A], 1)                      # 3x2
        new = {}
        for l in f.loops:
            st, *_ = np.linalg.lstsq(M, np.array(l.vert.co) - A, rcond=None)
            new[l.vert.index] = a + st[0] * (b - a) + st[1] * (c - a)
        updates.append((f.index, new))
        fixed += 1
    bm.free()
    me = ob.data          # write through the mesh API (nothing else in the skinned mesh is rewritten)
    uvd = me.uv_layers.active.data
    for fi, new in updates:
        for li in me.polygons[fi].loop_indices:
            vi = me.loops[li].vertex_index
            if vi in new:
                uvd[li].uv = (float(new[vi][0]), float(new[vi][1]))
    me.update()
    return fixed


def smart_uv(ob, angle=66.0, density=1.0):
    allf = np.ones(len(ob.data.polygons), bool)
    pipeline.smart_project_faces(ob, allf, angle=angle)
    pipeline.normalize_density(ob, allf, density)


# ----------------------------------------------------------------------------- kilt chains
def kilt_chain_points(kp, n):
    out = {}
    for side, a in (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2)):
        pts = []
        for i in range(n + 1):
            f = i / n
            z = (kp["top_z"] - 0.025) + ((kp["hem_z"] + 0.02) - (kp["top_z"] - 0.025)) * f
            r = kp["r_top"] + (kp["r_hem"] - kp["r_top"]) * (f * 0.9) - 0.012
            pts.append(V(math.sin(a) * r, kp["cy"] - math.cos(a) * r * kp["squash"], z))
        out[side] = pts
    return out


def kilt_angular_blend(P, names, W, kp, n):
    """Share each level's chain weight between the two nearest kilt chains (cosine partition, Brann r2 lesson)."""
    theta = np.arctan2(P[:, 0], -(P[:, 1] - kp["cy"]) / kp["squash"])
    sides = (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2))
    part = np.stack([np.maximum(np.cos(theta - a), 0.0) ** 1.6 for _, a in sides], axis=1)
    part /= np.maximum(part.sum(axis=1, keepdims=True), 1e-6)
    W = W.copy()
    for i in range(1, n + 1):
        cols = [names.index(f"kilt_{sd}_{i}") if f"kilt_{sd}_{i}" in names else -1 for sd, _ in sides]
        if min(cols) < 0:
            continue
        level = W[:, cols].sum(axis=1)
        W[:, cols] = level[:, None] * part
    return W


def skin_kilt(kilt_lo, arm, kp, n, share=0.55):
    kilt_bones = ["hips", "thigh_L", "thigh_R"] + [b.name for b in arm.data.bones if b.name.startswith("kilt_")]
    top = kp["top_z"]

    def post(P, names, W):
        for t in ("thigh_L", "thigh_R"):
            W[:, names.index(t)] = 0.0
        W = kilt_angular_blend(P, names, W, kp, n)
        W, _ = skin.top_k(W, 4)
        return skin.skirt_weights(P, names, W, top, kp["hem_z"], share=share, seam=0.12)
    return skin.skin(kilt_lo, arm, method="sdf", allowed=kilt_bones, power=3.0, post=post,
                     overrides=[(lambda P: np.clip((P[:, 2] - (top - 0.05)) / 0.04, 0, 1), "hips")])


# ----------------------------------------------------------------------------- weight masks
def wrist_mask(L, side, beyond=0.012, soft=0.02, reach=0.16):
    w = L["wrist_" + side]
    h = L["hand_h_" + side]

    def fn(P):
        near = np.linalg.norm(P - w, axis=1) < reach
        return np.clip(((P - w) @ h - beyond) / soft + 0.5, 0, 1) * near
    return fn


def head_mask(H, a=(0, -0.09, -0.142), b=(0, 0.10, -0.085), reach=0.26):
    """Everything above the jaw line plane -> head (rigid skull)."""
    a, b = H(*a), H(*b)
    nrm = norm(np.cross(V(1, 0, 0), b - a))
    if nrm[2] < 0:
        nrm = -nrm
    c = (a + b) * 0.5

    def fn(P):
        s = (P - c) @ nrm
        return np.clip((s + 0.004) / 0.02, 0, 1) * (np.linalg.norm(P - H(0, 0, 0), axis=1) < reach * H.s)
    return fn


def rigid_bind(ob, arm, bone):
    """Rigid gear piece: 100% one bone (docs: rigid gear per bone)."""
    n = len(ob.data.vertices)
    skin.write_groups(ob, [bone], np.ones((n, 1)))
    skin.bind(ob, arm)


# ----------------------------------------------------------------------------- textures
def composite_maps(maps, out_tex, prefix, albedo=None, prm=None, tint=(0.52, 0.30, 0.26), dil=16):
    """AO/cavity-tinted albedo + ORM + normal PNGs (public/assets/textures/<prefix>_*.png). albedo/prm override
    the maps' passes (per-variant re-bakes share AO + normal)."""
    alb = maps["albedo"] if albedo is None else albedo
    prm = maps["prm"] if prm is None else prm
    cov = alb[..., 3] > 0.5
    ao = maps["ao"]
    ao_s = np.clip(ao[..., 0], 0, 1)
    ao_l = np.clip(ao[..., 1], 0, 1)
    rgb = alb[..., :3].copy()
    occl = np.clip(1.0 - 0.75 * (1 - ao_s) - 0.45 * (1 - ao_l), 0, 1)[..., None]
    t = np.array(tint)
    rgb = rgb * (t + (1 - t) * occl)
    orm = np.stack([np.clip(0.35 + 0.65 * ao_l * (0.5 + 0.5 * ao_s), 0, 1), np.clip(prm[..., 0], 0.04, 1),
                    np.clip(prm[..., 1], 0, 1)], axis=-1)
    n3 = maps["normal"][..., :3]
    rgb = pipeline.dilate(rgb, cov, dil)
    orm = pipeline.dilate(orm, cov, dil)
    n3 = pipeline.dilate(n3, cov, dil)
    tex = {}
    tex["albedo"] = pipeline.save_png(rgb, os.path.join(out_tex, prefix + "_albedo.png"), prefix + "_albedo", "sRGB",
                                      linear_to_srgb=True)
    tex["orm"] = pipeline.save_png(orm, os.path.join(out_tex, prefix + "_orm.png"), prefix + "_orm", "Non-Color")
    tex["normal"] = pipeline.save_png(n3, os.path.join(out_tex, prefix + "_normal.png"), prefix + "_normal",
                                      "Non-Color")
    return tex


# ----------------------------------------------------------------------------- clay previews
def assign_clay(ob, mat_of_vertex, materials, colors):
    for mname in materials:
        ob.data.materials.append(preview.clay_material("clay_" + mname, colors.get(mname, (0.5, 0.5, 0.5))))
    me = ob.data
    pv = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", pv)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    me.polygons.foreach_set("material_index", mat_of_vertex[lv[pv]].astype(np.int32))


def mesh_sculpt(S, name, h, lo=None, hi=None, colors=None, offset=None):
    v, q, t = sdf.polygonize(S, h, lo, hi)
    if offset is not None:
        v = v + np.asarray(offset)[None]
    ob = meshutil.mesh_from_numpy(name, v, q, t)
    if colors is not None:
        P = v - (np.asarray(offset)[None] if offset is not None else 0)
        d, mat, paints = S.eval_points(P)
        assign_clay(ob, mat, S.materials, colors)
    return ob


def trace_in(S, c, d, r=0.5, iters=260):
    """Sphere-trace from OUTSIDE (c + d r) back toward c: the first outer surface along -d. Use this for thin
    shells (a ray from inside the body starts outside a shell and ray_hit would return the origin)."""
    d = norm(V(d))
    p0 = V(c) + d * r
    t = 0.0
    for _ in range(iters):
        q = p0 - d * t
        dist = float(S.dist(q[None])[0])
        if dist < 2e-4:
            return q
        t += min(max(dist * 0.9, 2e-4), 0.008)     # FAR outside the ops' bounds: march, don't jump
        if t > r:
            break
    return V(c)


class GridSDF(sdf.Prim):
    """Frozen, grid-sampled copy of a Sculpt's distance field (trilinear). A plain Snapshot re-evaluates every body
    op per query point when used inside ANOTHER sculpt (separate gear meshes), which made 13 marauder gear pieces
    take > 1 h; sampling the body once (3-4 mm grid, chunked eval_block) makes Offset/shell gear queries cheap.
    Accuracy ~ h/4 near smooth surfaces -- use it for standoff gear (>= 2 h off the skin), not for fine detail."""

    def __init__(self, S, h=0.004, lo=None, hi=None, pad=0.06, clamp=0.12, zchunk=48):
        blo, bhi = S.bounds()
        lo = np.maximum(V(*lo) if lo is not None else blo - pad, blo - pad)
        hi = np.minimum(V(*hi) if hi is not None else bhi + pad, bhi + pad)
        self.h = float(h)
        self.x0 = lo.astype(float)
        shape = np.ceil((hi - lo) / h).astype(int) + 1
        self.shape = shape
        G = np.empty(tuple(shape), np.float32)
        for k0 in range(0, shape[2], zchunk):
            nz = min(zchunk, shape[2] - k0)
            G[:, :, k0:k0 + nz] = S.eval_block(self.x0 + V(0, 0, k0 * h), h, (shape[0], shape[1], nz))
        np.clip(G, -clamp, clamp, out=G)
        self.G = G
        self.lo, self.hi = self.x0, self.x0 + h * (shape - 1)
        pipeline.log(f"GridSDF {tuple(shape)} h={h*1000:.1f}mm ({G.nbytes/1e6:.0f} MB)")

    def d(self, X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        shp = X.shape
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        f = (P - self.x0) / self.h
        n = self.shape
        fc = np.clip(f, 0, n - 1.000001)
        i = np.floor(fc).astype(np.int64)
        t = fc - i
        G = self.G
        out = np.zeros(len(P))
        for dx in (0, 1):
            wx = t[:, 0] if dx else 1 - t[:, 0]
            for dy in (0, 1):
                wy = t[:, 1] if dy else 1 - t[:, 1]
                for dz in (0, 1):
                    wz = t[:, 2] if dz else 1 - t[:, 2]
                    out += wx * wy * wz * G[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        out += np.linalg.norm((f - fc) * self.h, axis=1)      # outside the grid: grows with the distance
        return out.reshape(shp)
