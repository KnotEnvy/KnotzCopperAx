"""KnotzCopperAx character/prop build pipeline (headless Blender 5.x).

    Sculpt (lib/sdf) --polygonize--> HI meshes (bake sources, fine voxel, with attributes)
                     --polygonize + decimate--> LO meshes (game topology, triangle budget)
    LO --uv_atlas--> one shared UV atlas (per-region texel density, packed)
    HI --bake (Cycles, GPU OptiX/CUDA, CPU fallback)--> albedo / normal / AO / roughness+metal (+emissive)
    numpy composite --> base colour (AO/cavity tinted), ORM, normal PNGs  ->  one glTF PBR material
    LO + armature --skin (lib/skin)--> join --> export GLB (+Y up, skins, embedded textures, contract names)

Everything here is asset-agnostic; build_<asset>.py scripts decide sculpts, budgets and regions.
"""
import os
import math
import time
import json
import numpy as np
import bpy
import bmesh

from . import sdf, meshutil

def LOG(*a):
    print(*a, flush=True)


def log(*a):
    LOG("[pipe]", *a)


# ============================================================================ Cycles device
def setup_cycles(device="AUTO", samples=16):
    """Pick OPTIX > CUDA > CPU (or the requested one). Returns the device type actually used."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    # tools/blender-run.mjs sets KCA_CYCLES_DEVICE per machine (WSL2: CUDA, because OptiX lists the GPU there but
    # can't create a context). An explicit --device OPTIX/CUDA/CPU from the caller still wins.
    if device in ("AUTO", "GPU") and os.environ.get("KCA_CYCLES_DEVICE"):
        device = os.environ["KCA_CYCLES_DEVICE"].upper()
    chosen = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        order = {"AUTO": ["OPTIX", "CUDA"], "GPU": ["OPTIX", "CUDA"], "OPTIX": ["OPTIX"], "CUDA": ["CUDA"],
                 "CPU": []}.get(device, ["OPTIX", "CUDA"])
        for t in order:
            try:
                prefs.compute_device_type = t
                prefs.refresh_devices()
                if any(d.type == t for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = (d.type == t)
                    chosen = t
                    break
            except Exception:
                continue
    except Exception as e:
        log("cycles prefs unavailable:", e)
    sc.cycles.device = "GPU" if chosen != "CPU" else "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    try:
        sc.cycles.use_adaptive_sampling = False
    except Exception:
        pass
    log("cycles device:", chosen)
    return chosen


# ============================================================================ sculpt -> meshes
def eval_attrs(S, P, chunk=300000):
    """Material index + paint masks of a sculpt at points (chunked)."""
    n = len(P)
    mat = np.empty(n, np.int32)
    paints = {c: np.empty(n) for c in S.paint_channels}
    for i in range(0, n, chunk):
        d, m, pt = S.eval_points(P[i:i + chunk])
        mat[i:i + chunk] = m
        for c in paints:
            paints[c][i:i + chunk] = pt[c]
    return mat, paints


def face_centers(ob):
    me = ob.data
    V = meshutil.get_verts(ob)
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    C = np.zeros((len(ls), 3))
    for k in range(int(lt.max()) if len(lt) else 0):
        m = lt > k
        C[m] += V[lv[ls[m] + k]]
    return C / lt[:, None]


def sculpt_mesh(S, name, h, lo=None, hi=None, attrs=True, face_mats=True, keep_box=None, drop_box=None):
    """Polygonize a sculpt into a mesh object. attrs: paint channels as POINT float attributes 'p_<chan>'
    and per-face material indices (slot order = S.materials). keep_box/drop_box = (lo, hi) face filters
    (by face centre) used to split one sculpt into several bake sources at different resolutions."""
    v, q, t = sdf.polygonize(S, h, lo, hi, log=lambda m: log(m))
    ob = meshutil.mesh_from_numpy(name, v, q, t)
    if keep_box is not None or drop_box is not None:
        C = face_centers(ob)
        kill = np.zeros(len(C), bool)
        if keep_box is not None:
            a, b = keep_box
            kill |= ~np.all((C >= a) & (C <= b), axis=1)
        if drop_box is not None:
            a, b = drop_box
            kill |= np.all((C >= a) & (C <= b), axis=1)
        delete_faces(ob, kill)
        v = meshutil.get_verts(ob)
    if attrs:
        t0 = time.time()
        vm, paints = eval_attrs(S, v)
        for c, w in paints.items():
            meshutil.add_float_attr(ob, "p_" + c, w)
        meshutil.add_float_attr(ob, "mat_id", vm.astype(np.float32))
        if face_mats:
            C = face_centers(ob)
            fm, _ = eval_attrs_mat_only(S, C)
            set_face_mats(ob, fm)
        log(f"{name}: attrs {time.time()-t0:.1f}s")
    return ob


def set_face_mats(ob, fm):
    """Per-face material ids, kept in an INT FACE attribute 'fmat' too (slot edits can reset material_index)."""
    me = ob.data
    fm = np.asarray(fm, np.int32)
    if "fmat" in me.attributes:
        me.attributes.remove(me.attributes["fmat"])
    a = me.attributes.new("fmat", "INT", "FACE")
    a.data.foreach_set("value", fm)
    me.polygons.foreach_set("material_index", fm)


def restore_face_mats(ob):
    me = ob.data
    if "fmat" not in me.attributes:
        return
    fm = np.empty(len(me.polygons), np.int32)
    me.attributes["fmat"].data.foreach_get("value", fm)
    me.polygons.foreach_set("material_index", fm)
    me.update()


def eval_attrs_mat_only(S, P, chunk=300000):
    n = len(P)
    mat = np.empty(n, np.int32)
    for i in range(0, n, chunk):
        _, m, _ = S.eval_points(P[i:i + chunk])
        mat[i:i + chunk] = m
    return mat, None


def delete_faces(ob, mask):
    if not mask.any():
        return
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    kill = [bm.faces[i] for i in np.nonzero(mask)[0]]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def face_vert_mask_tris(ob, vmask):
    """Triangles of faces whose vertices are all inside vmask."""
    me = ob.data
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    lf = np.repeat(np.arange(len(ls)), lt)
    inside = np.ones(len(ls), bool)
    np.logical_and.at(inside, lf, vmask[lv])
    return int((lt[inside] - 2).sum())


def decimate_regions(ob, regions, symmetry=True):
    """Exact per-region triangle budgets. Blender's Decimate vertex group acts as a near-binary mask (weight-1
    vertices get decimated, the rest are kept), so each region is decimated on its own to its target.
    regions: [(vertex_mask_fn(P) -> bool array, target_tris)], applied in order."""
    for fn, target in regions:
        P = meshutil.get_verts(ob)
        m = np.asarray(fn(P), bool)
        tin = face_vert_mask_tris(ob, m)
        cur = meshutil.tri_count(ob)
        if tin <= target or not m.any():
            continue
        want = cur - tin + target
        vg = ob.vertex_groups.new(name="__dec")
        vg.add(np.nonzero(m)[0].tolist(), 1.0, "REPLACE")
        md = ob.modifiers.new("dec", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.ratio = max(0.0005, want / cur)
        md.use_collapse_triangulate = True
        md.use_symmetry = symmetry
        md.symmetry_axis = "X"
        md.vertex_group = "__dec"
        md.vertex_group_factor = 1.0
        md.invert_vertex_group = False
        meshutil.apply_modifiers(ob)
        ob.vertex_groups.remove(ob.vertex_groups["__dec"])
        log(f"  region decimate {ob.name}: {tin} -> ~{target} (mesh {cur} -> {meshutil.tri_count(ob)})")


def lowpoly(S, name, h, target_tris, lo=None, hi=None, regions=None, symmetry=True, smooth=0, clean=None):
    """Game mesh: coarse polygonize -> optional smoothing -> collapse-decimate to the triangle budget.
    regions: optional [(vertex_mask_fn, tris)] decimated first (e.g. the face gets a denser budget), then the
    whole mesh is decimated to target_tris."""
    v, q, t = sdf.polygonize(S, h, lo, hi, log=lambda m: log(m))
    ob = meshutil.mesh_from_numpy(name, v, q, t)
    if clean is not None:          # optional hook on the raw polygonized mesh (e.g. drop loose specks) -- additive
        clean(ob)
    if smooth:
        meshutil.smooth_verts(ob, iters=smooth, factor=0.4)
    if regions:
        decimate_regions(ob, regions, symmetry)
    meshutil.decimate(ob, target_tris, symmetry=symmetry)
    meshutil.triangulate(ob)
    log(f"{name}: {meshutil.tri_count(ob)} tris")
    return ob


# ============================================================================ geometry attributes
def edges_of(ob):
    me = ob.data
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def vertex_normals(ob):
    me = ob.data
    n = np.empty(len(me.vertices) * 3, np.float32)
    try:
        me.vertex_normals.foreach_get("vector", n)
    except Exception:
        me.vertices.foreach_get("normal", n)
    return n.reshape(-1, 3).astype(np.float64)


def nb_mean(E, X, nv):
    """Mean of X over mesh neighbours (umbrella operator), X (nv,) or (nv,k)."""
    cnt = np.bincount(E[:, 0], minlength=nv) + np.bincount(E[:, 1], minlength=nv)
    cnt = np.maximum(cnt, 1)
    if X.ndim == 1:
        s = np.bincount(E[:, 0], X[E[:, 1]], nv) + np.bincount(E[:, 1], X[E[:, 0]], nv)
        return s / cnt
    out = np.empty_like(X)
    for k in range(X.shape[1]):
        out[:, k] = (np.bincount(E[:, 0], X[E[:, 1], k], nv) + np.bincount(E[:, 1], X[E[:, 0], k], nv)) / cnt
    return out


def curvature(ob, smooth_iters=(2, 14), scale=(40.0, 25.0)):
    """Signed mean-curvature estimates (convex > 0), smoothed at two scales, mapped to [-1, 1] by tanh(k/scale).
    Returns list of arrays (one per scale). Units: 1/m before mapping (40/m ~ 2.5 cm radius)."""
    V = meshutil.get_verts(ob)
    N = vertex_normals(ob)
    E = edges_of(ob)
    nv = len(V)
    L = nb_mean(E, V, nv) - V
    el = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
    el2 = np.bincount(E[:, 0], el * el, nv) + np.bincount(E[:, 1], el * el, nv)
    cnt = np.maximum(np.bincount(E[:, 0], minlength=nv) + np.bincount(E[:, 1], minlength=nv), 1)
    el2 = np.maximum(el2 / cnt, 1e-10)
    k = -2.0 * np.sum(L * N, axis=1) / el2
    k = np.clip(k, -800, 800)
    outs = []
    cur = k.copy()
    done = 0
    for it, sc in zip(smooth_iters, scale):
        for _ in range(it - done):
            cur = 0.5 * cur + 0.5 * nb_mean(E, cur, nv)
        done = it
        outs.append(np.tanh(cur / sc))
    return outs


# ============================================================================ UV atlas
def _edit(obs):
    meshutil.select_only(obs, obs[0])
    bpy.ops.object.mode_set(mode="EDIT")


def _object():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def ensure_uv(ob, name="UVMap"):
    me = ob.data
    if name not in me.uv_layers:
        me.uv_layers.new(name=name)
    me.uv_layers.active = me.uv_layers[name]
    return me.uv_layers[name]


def smart_project_faces(ob, face_mask, angle=62.0):
    """Smart UV project only the faces in face_mask (other faces keep their UVs)."""
    me = ob.data
    ensure_uv(ob)
    sel = np.asarray(face_mask, bool)
    me.polygons.foreach_set("select", sel)
    _edit([ob])
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.polygons.foreach_set("select", sel)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def loop_arrays(ob, uv_name="UVMap"):
    me = ob.data
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers[uv_name].data.foreach_get("uv", uv)
    lf = np.repeat(np.arange(len(ls)), lt)
    return ls, lt, lv, uv.reshape(-1, 2).astype(np.float64), lf


def set_loop_uv(ob, uv, uv_name="UVMap"):
    ob.data.uv_layers[uv_name].data.foreach_set("uv", np.asarray(uv, np.float32).ravel())


def face_areas_3d_uv(ob, uv_name="UVMap"):
    """Per-face 3D area and UV area (fan triangulation)."""
    V = meshutil.get_verts(ob)
    ls, lt, lv, uv, lf = loop_arrays(ob, uv_name)
    A3 = np.zeros(len(ls))
    Au = np.zeros(len(ls))
    for k in range(1, int(lt.max()) - 1):
        m = lt > k + 1
        a, b, c = ls[m], ls[m] + k, ls[m] + k + 1
        A3[m] += 0.5 * np.linalg.norm(np.cross(V[lv[b]] - V[lv[a]], V[lv[c]] - V[lv[a]]), axis=1)
        e1, e2 = uv[b] - uv[a], uv[c] - uv[a]
        Au[m] += 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    return A3, Au


def normalize_density(ob, face_mask, density, uv_name="UVMap"):
    """Scale the UVs of face_mask faces so uv_area = density^2 * area3d (islands are packed later)."""
    A3, Au = face_areas_3d_uv(ob, uv_name)
    m = np.asarray(face_mask, bool)
    a3, au = A3[m].sum(), Au[m].sum()
    if au <= 1e-12:
        return
    s = density * math.sqrt(a3 / au)
    ls, lt, lv, uv, lf = loop_arrays(ob, uv_name)
    lm = m[lf]
    uv[lm] *= s
    set_loop_uv(ob, uv, uv_name)


def uv_from_attr_lockuv(ob, lock_scale, uv_name="UVMap", src="lockuv"):
    """Copy the per-lock 'lockuv' rectangle into UVMap, scaled per lock to physical (u=perimeter, v=length)."""
    me = ob.data
    ensure_uv(ob, uv_name)
    src_uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers[src].data.foreach_get("uv", src_uv)
    src_uv = src_uv.reshape(-1, 2).astype(np.float64)
    ls, lt, lv, _, lf = loop_arrays(ob, uv_name)
    lid = np.empty(len(me.vertices), np.float32)
    me.attributes["lock_id"].data.foreach_get("value", lid)
    lid_l = lid[lv].astype(int)
    su = np.array([lock_scale[i][0] for i in range(len(lock_scale))])
    sv = np.array([lock_scale[i][1] for i in range(len(lock_scale))])
    out = np.stack([src_uv[:, 0] * su[lid_l], src_uv[:, 1] * sv[lid_l]], axis=1)
    # offset each lock so islands don't coincide before packing (packer relocates them anyway)
    out[:, 0] += lid_l * 0.0
    set_loop_uv(ob, out, uv_name)
    me.uv_layers.active = me.uv_layers[uv_name]
    for l in list(me.uv_layers):
        l.active_render = (l.name == uv_name)


def face_adjacency(ob):
    """(pairs Kx2 of face indices sharing an edge, boundary edge mask) via bmesh."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    pairs = []
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            pairs.append((lf[0].index, lf[1].index))
    bm.free()
    return np.array(pairs, np.int64).reshape(-1, 2)


def clean_labels(labels, pairs, iters=3):
    """Majority-vote smoothing of per-face region labels over face adjacency (kills tiny fragments)."""
    lab = labels.copy()
    n = len(lab)
    for _ in range(iters):
        nb = [[] for _ in range(n)]
        for a, b in pairs:
            nb[a].append(lab[b])
            nb[b].append(lab[a])
        new = lab.copy()
        for i in range(n):
            if len(nb[i]) >= 2:
                vals, cnt = np.unique(nb[i], return_counts=True)
                if cnt.max() >= 2 and vals[np.argmax(cnt)] != lab[i] and (np.array(nb[i]) != lab[i]).sum() >= 2:
                    new[i] = vals[np.argmax(cnt)]
        lab = new
    return lab


def region_unwrap(ob, face_region, cfg, method="ANGLE_BASED"):
    """Artist-style charts for organic meshes: seams at region boundaries (e.g. dominant skin bone) plus one
    meridian cut per tube-like region on its hidden side, then angle-based unwrap and per-region density.
    cfg: {region_id: dict(axis=(a, b) | None, ref=vec | None, density=float, halves=bool)} (ref = direction of
    the cut; halves=True cuts at +ref and -ref)."""
    me = ob.data
    ensure_uv(ob)
    C = face_centers(ob)
    nf = len(C)
    side = np.zeros(nf, np.int8)
    for rid, c in cfg.items():
        m = face_region == rid
        if not m.any() or c.get("axis") is None or c.get("ref") is None:
            continue
        a, b = (np.asarray(x, float) for x in c["axis"])
        ax = b - a
        ax /= max(np.linalg.norm(ax), 1e-9)
        e1 = np.asarray(c["ref"], float)
        e1 = e1 - ax * (e1 @ ax)
        e1 /= max(np.linalg.norm(e1), 1e-9)
        e2 = np.cross(ax, e1)
        d = C[m] - a
        d = d - np.outer(d @ ax, ax)
        x, y = d @ e1, d @ e2
        s = np.where(y >= 0, 1, -1)
        # one meridian cut on the `ref` side, or (halves=True) two cuts at +-ref -> two half-tubes, which keeps
        # the widest charts (torso rings, head) from capping the atlas scale
        side[np.nonzero(m)[0]] = s if c.get("halves") else np.where(x > 0, s, 0)
    bm = bmesh.new()
    bm.from_mesh(me)
    nseam = 0
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            e.seam = True
            continue
        f0, f1 = lf[0].index, lf[1].index
        seam = face_region[f0] != face_region[f1] or (side[f0] != 0 and side[f1] != 0 and side[f0] != side[f1])
        e.seam = bool(seam)
        nseam += seam
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("select", np.ones(nf, bool))
    _edit([ob])
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.unwrap(method=method, fill_holes=True, correct_aspect=True, margin=0.0)
    except TypeError:
        bpy.ops.uv.unwrap(method=method, margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    for rid, c in cfg.items():
        m = face_region == rid
        if m.any():
            normalize_density(ob, m, c.get("density", 1.0))
    log(f"region_unwrap {ob.name}: {len(cfg)} regions, {nseam} seam edges")


def uv_islands(ob, uv_name="UVMap"):
    """Island id per loop: loops are welded when they share a vertex AND the same UV; faces are islands' atoms."""
    ls, lt, lv, uv, lf = loop_arrays(ob, uv_name)
    n = len(lv)
    parent = np.arange(n)

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # corners of one face belong together
    for k in range(1, int(lt.max())):
        m = lt > k
        for a, b in zip(ls[m], ls[m] + k):
            union(a, b)
    key = np.round(uv * 2e5).astype(np.int64)
    order = np.lexsort((key[:, 1], key[:, 0], lv))
    same = (lv[order][1:] == lv[order][:-1]) & np.all(key[order][1:] == key[order][:-1], axis=1)
    for i in np.nonzero(same)[0]:
        union(order[i], order[i + 1])
    roots = np.array([find(i) for i in range(n)])
    _, isl = np.unique(roots, return_inverse=True)
    return isl, uv


def _hull(P):
    P = np.unique(np.round(P, 9), axis=0)
    if len(P) < 3:
        return P
    P = P[np.lexsort((P[:, 1], P[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in P:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in P[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def _min_rect_angle(P):
    H = _hull(P)
    if len(H) < 3:
        return 0.0
    best, ang = 1e30, 0.0
    E = np.roll(H, -1, axis=0) - H
    for e in E:
        a = -math.atan2(e[1], e[0])
        c, s = math.cos(a), math.sin(a)
        R = H @ np.array([[c, s], [-s, c]])
        area = np.ptp(R[:, 0]) * np.ptp(R[:, 1])
        if area < best:
            best, ang = area, a
    return ang


def pack_atlas_skyline(obs, margin_px=4, res=2048, uv_name="UVMap"):
    """Deterministic atlas packer: islands of all objects (relative scale kept), min-area-rectangle rotation,
    lay long side horizontal, skyline bottom-left packing, binary search on the global scale. ~65-80% fill on
    character meshes vs ~30% from the stock packer on decimated triangle soups."""
    items = []   # (obj index, loop indices, rotated points, w, h)
    per_obj = []
    for oi, ob in enumerate(obs):
        isl, uv = uv_islands(ob, uv_name)
        per_obj.append(uv.copy())
        for k in range(isl.max() + 1):
            idx = np.nonzero(isl == k)[0]
            P = uv[idx]
            a = _min_rect_angle(P)
            c, s = math.cos(a), math.sin(a)
            R = P @ np.array([[c, s], [-s, c]])
            w, h = np.ptp(R[:, 0]), np.ptp(R[:, 1])
            if h > w:                                   # long side horizontal
                R = np.stack([R[:, 1], -R[:, 0]], axis=1)
                w, h = h, w
            R -= R.min(axis=0)
            items.append([oi, idx, R, max(w, 1e-6), max(h, 1e-6)])
    order = sorted(range(len(items)), key=lambda i: -items[i][4])
    m = margin_px / res

    def try_pack(k):
        # skyline: list of (x, width, y) segments
        sky = [[0.0, 1.0, 0.0]]
        pos = {}
        for i in order:
            w, h = items[i][3] * k + m, items[i][4] * k + m
            if w > 1.0:
                return None
            best = None
            for si in range(len(sky)):
                x = sky[si][0]
                if x + w > 1.0 + 1e-9:
                    break
                # y = max skyline height over [x, x+w]
                y, j, rem = 0.0, si, w
                while rem > 1e-12 and j < len(sky):
                    y = max(y, sky[j][2])
                    rem -= sky[j][1] if j > si else (sky[j][0] + sky[j][1] - x)
                    j += 1
                if y + h > 1.0 + 1e-9:
                    continue
                if best is None or y < best[1] - 1e-12 or (abs(y - best[1]) < 1e-12 and x < best[0]):
                    best = (x, y)
            if best is None:
                return None
            x, y = best
            pos[i] = (x + m * 0.5, y + m * 0.5)
            # update skyline
            nx0, nx1, ny = x, x + w, y + h
            new = []
            for seg in sky:
                s0, s1 = seg[0], seg[0] + seg[1]
                if s1 <= nx0 + 1e-12 or s0 >= nx1 - 1e-12:
                    new.append(seg)
                    continue
                if s0 < nx0:
                    new.append([s0, nx0 - s0, seg[2]])
                if s1 > nx1:
                    new.append([nx1, s1 - nx1, seg[2]])
            new.append([nx0, nx1 - nx0, ny])
            new.sort(key=lambda sgm: sgm[0])
            merged = []
            for seg in new:
                if merged and abs(merged[-1][2] - seg[2]) < 1e-12 and abs(merged[-1][0] + merged[-1][1] - seg[0]) < 1e-9:
                    merged[-1][1] += seg[1]
                else:
                    merged.append(seg)
            sky = merged
        return pos

    area = sum(it[3] * it[4] for it in items)
    lo, hi = 0.0, 1.0 / math.sqrt(max(area, 1e-12))
    best = None
    for _ in range(22):
        mid = (lo + hi) / 2
        p = try_pack(mid)
        if p is None:
            hi = mid
        else:
            lo, best = mid, p
    if best is None:
        raise RuntimeError("skyline pack failed")
    k = lo
    for i, (oi, idx, R, w, h) in enumerate(items):
        x, y = best[i]
        per_obj[oi][idx] = R * k + np.array([x, y])
    for ob, uv in zip(obs, per_obj):
        set_loop_uv(ob, uv, uv_name)
    fill = sum(it[3] * it[4] for it in items) * k * k
    log(f"skyline atlas: {len(items)} islands, scale {k:.3f}, bbox fill {fill*100:.1f}%")
    return fill


def uv_coverage(obs, uv_name="UVMap"):
    """True UV area covered by all faces of `obs` (0..1) — the honest atlas-efficiency number."""
    tot = 0.0
    for ob in obs:
        _, Au = face_areas_3d_uv(ob, uv_name)
        tot += float(Au.sum())
    return tot


def pack_atlas_shape(obs, margin_px=4, res=2048, uv_name="UVMap", fallback=True):
    """Shape-aware atlas packing of all objects together (Blender's CONCAVE island packer, relative texel
    density preserved, any rotation). Jagged decimated charts pack ~2x tighter than with bounding boxes.
    Falls back to pack_atlas_skyline on older Blender builds. Returns true UV coverage."""
    for ob in obs:
        ensure_uv(ob, uv_name)
    _object()
    meshutil.select_only(obs, obs[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    kw = dict(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True, merge_overlap=False,
              margin_method="FRACTION", margin=margin_px / res, pin=False, shape_method="CONCAVE")
    ok = True
    try:
        bpy.ops.uv.pack_islands(**kw)
    except TypeError:
        try:
            bpy.ops.uv.pack_islands(rotate=True, margin=margin_px / res)
        except Exception as e:
            log("pack_islands failed:", e)
            ok = False
    bpy.ops.object.mode_set(mode="OBJECT")
    if not ok and fallback:
        pack_atlas_skyline(obs, margin_px, res, uv_name)
    cov = uv_coverage(obs, uv_name)
    log(f"shape atlas: true UV coverage {cov*100:.1f}%")
    return cov


def pack_atlas(obs, margin=0.003, rotate=True):
    """Pack the UVMap islands of several objects together into [0,1]^2 keeping relative scale."""
    for o in obs:
        ensure_uv(o)
        o.data.polygons.foreach_set("select", np.ones(len(o.data.polygons), bool))
    _edit(obs)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    done = False
    for kw in (dict(udim_source="CLOSEST_UDIM", rotate=rotate, rotate_method="ANY", scale=True, merge_overlap=False,
                    margin_method="FRACTION", margin=margin, shape_method="CONCAVE"),
               dict(rotate=rotate, scale=True, margin_method="FRACTION", margin=margin),
               dict(rotate=rotate, margin=margin)):
        try:
            bpy.ops.uv.pack_islands(**kw)
            done = True
            log("pack_islands", kw)
            break
        except TypeError:
            continue
        except Exception as e:
            log("pack_islands failed:", e)
    bpy.ops.object.mode_set(mode="OBJECT")
    if not done:
        raise RuntimeError("pack_islands failed")
    # report fill ratio
    tot = 0.0
    for o in obs:
        _, Au = face_areas_3d_uv(o)
        tot += Au.sum()
    log(f"atlas packed: {len(obs)} objects, UV fill {tot*100:.1f}%")
    return tot


# ============================================================================ baking
def new_image(name, res, alpha=True, float_buffer=True, color=(0, 0, 0, 0)):
    im = bpy.data.images.get(name)
    if im is not None:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, res, res, alpha=alpha, float_buffer=float_buffer)
    im.generated_color = color
    px = np.zeros((res * res, 4), np.float32)
    px[:] = color
    im.pixels.foreach_set(px.ravel())
    return im


def image_np(im):
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _bake_target_material(lo, im):
    """Make sure every material slot of `lo` has an active image node pointing at `im`."""
    if not lo.data.materials:
        m = bpy.data.materials.new(lo.name + "_bake")
        lo.data.materials.append(m)
    for m in lo.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        n = nt.nodes.get("__bake_target")
        if n is None:
            n = nt.nodes.new("ShaderNodeTexImage")
            n.name = "__bake_target"
        n.image = im
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n


def bake_pass(lo, his, im, kind="EMIT", extrusion=0.01, max_ray=0.03, samples=4, device_cpu_fallback=True):
    """Selected-to-active bake of `his` onto `lo` into image `im` (margin 0; we dilate ourselves).
    kind: EMIT | NORMAL. Ray visibility of other LO objects must already be disabled."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    _bake_target_material(lo, im)
    meshutil.select_only(list(his) + [lo], lo)
    kw = dict(type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=max_ray,
              margin=0, use_clear=False, target="IMAGE_TEXTURES")
    if kind == "NORMAL":
        kw.update(normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z")
    t0 = time.time()
    try:
        bpy.ops.object.bake(**kw)
    except RuntimeError as e:
        if not device_cpu_fallback or sc.cycles.device == "CPU":
            raise
        log("GPU bake failed, retrying on CPU:", e)
        sc.cycles.device = "CPU"
        bpy.ops.object.bake(**kw)
    log(f"bake {kind} {lo.name} <- {[h.name for h in his]} {time.time()-t0:.1f}s")


def dilate(img, cov, px=12):
    """Push colours outward from covered texels into empty ones (seam padding). img (h,w,c), cov (h,w) bool."""
    out = img.copy()
    c = cov.copy()
    for _ in range(px):
        if c.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(c.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh = np.roll(np.roll(out * c[..., None], dy, 0), dx, 1)
            sc_ = np.roll(np.roll(c, dy, 0), dx, 1)
            acc += sh
            cnt += sc_
        grow = (~c) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        c = c | grow
    # anything still empty: global mean
    if (~c).any():
        out[~c] = out[c].mean(axis=0) if c.any() else 0.5
    return out


def save_png(arr, path, name=None, colorspace="sRGB", linear_to_srgb=False):
    """arr (h,w,3|4) float [0,1] (display-referred unless linear_to_srgb) -> 8-bit PNG via Blender."""
    h, w = arr.shape[:2]
    a = np.clip(arr, 0, 1).astype(np.float32)
    if linear_to_srgb:
        a = a.copy()
        a[..., :3] = lin2srgb(a[..., :3])
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones((h, w, 1), np.float32)], axis=2)
    nm = name or os.path.splitext(os.path.basename(path))[0]
    im = bpy.data.images.get(nm)
    if im is not None:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(nm, w, h, alpha=True, float_buffer=False)
    im.colorspace_settings.name = "Non-Color"      # write values verbatim
    im.pixels.foreach_set(a.ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    im = bpy.data.images.load(path, check_existing=False)
    im.name = nm
    im.colorspace_settings.name = colorspace
    return im


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb2lin(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def set_ray_visibility(ob, on):
    for a in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission",
              "visible_volume_scatter", "visible_shadow"):
        try:
            setattr(ob, a, on)
        except Exception:
            pass


class Baker:
    """Bakes a list of (lo, [hi...], extrusion, max_ray) jobs into shared atlas images, then composites.
    Pass switching is done by lib/shaders.set_pass on every HI material."""

    def __init__(self, res, jobs, set_pass, all_lo, all_hi):
        self.res, self.jobs, self.set_pass = res, jobs, set_pass
        self.all_lo, self.all_hi = all_lo, all_hi
        self.maps = {}

    def run(self, passes=(("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 48), ("normal", "NORMAL", 8))):
        for lo in self.all_lo:
            set_ray_visibility(lo, False)
        for h in self.all_hi:
            set_ray_visibility(h, True)
        for name, kind, spp in passes:
            im = new_image("bake_" + name, self.res)
            if kind == "NORMAL":
                im.colorspace_settings.name = "Non-Color"
            else:
                im.colorspace_settings.name = "Non-Color"   # raw linear values
            self.set_pass(self.all_hi, name)
            for (lo, his, ext, mr) in self.jobs:
                bake_pass(lo, his, im, kind, extrusion=ext, max_ray=mr, samples=spp)
            self.maps[name] = image_np(im)
            bpy.data.images.remove(im)
        for lo in self.all_lo:
            set_ray_visibility(lo, True)
        return self.maps


# ============================================================================ final material + export
def final_material(name, albedo_img, normal_img, orm_img, emissive_img=None, emissive_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = albedo_img
    nt.links.new(ta.outputs["Color"], bs.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal_img
    normal_img.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = orm_img
    orm_img.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    # glTF occlusion: custom group named "glTF Material Output" with an "Occlusion" input
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        try:
            grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        except Exception:
            grp.inputs.new("NodeSocketFloat", "Occlusion")
    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = grp
    nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
    if emissive_img is not None:
        te = nt.nodes.new("ShaderNodeTexImage")
        te.image = emissive_img
        nt.links.new(te.outputs["Color"], bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value = emissive_strength
    bs.inputs["IOR"].default_value = 1.5
    return m


def strip_for_export(ob, keep_uv="UVMap"):
    me = ob.data
    for l in list(me.uv_layers):
        if l.name != keep_uv:
            me.uv_layers.remove(l)
    for a in list(me.attributes):
        if a.name.startswith(".") or a.name in ("position", "sharp_face", "material_index") or a.is_internal:
            continue
        try:
            if a.domain in ("POINT", "CORNER", "FACE", "EDGE") and a.name not in (keep_uv,):
                me.attributes.remove(a)
        except Exception:
            pass
    for c in list(me.color_attributes):
        me.color_attributes.remove(c)


def export_glb(path, objects, scene_name=None, image_format="WEBP", quality=90, tangents=True):
    """Export only `objects` (armature + meshes) as GLB, +Y up, skins, no animation, textures embedded."""
    _object()
    meshutil.select_only(objects, objects[0])
    if scene_name:
        bpy.context.scene.name = scene_name
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_skins=True, export_animations=False, export_texcoords=True, export_normals=True,
              export_tangents=tangents, export_materials="EXPORT", export_image_format=image_format,
              export_image_quality=quality, export_def_bones=False, export_armature_object_remove=True,
              export_rest_position_armature=True, export_influence_nb=4, export_all_influences=False,
              export_extras=False, export_vertex_color="NONE")
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ("export_vertex_color", "export_armature_object_remove", "export_image_quality"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    log(f"exported {path} ({os.path.getsize(path)/1e6:.2f} MB)")
    return path


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
