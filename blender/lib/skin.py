"""Skin weights for contract rigs.

method='heat'  Blender automatic weights (bone heat), validated (every vertex weighted, no bone further than
               `max_reach` from a vertex it influences); failure -> falls back to 'sdf'.
method='sdf'   Robust and deterministic: distance to bone segments, penalised when the straight path from the
               vertex to the bone leaves the body (tested against the sculpt SDF, so an arm vertex never binds to
               the torso across the armpit gap and inner thighs never bind the other leg), inverse-power
               falloff, Laplacian smoothing over the mesh, top-4 influences.
Then:  overrides  [(mask_fn(P)->0..1, bone)]  force regions to one bone (head above the jaw line, fists)
       rigid      [vertex index arrays]       make accessories move rigidly (group-averaged weights)
Chains (kilt/hair/cape) use method='sdf' with an `allowed` bone subset and no SDF.
"""
import math
import numpy as np
import bpy

from . import meshutil
from .pipeline import edges_of, nb_mean, log


def bone_segments(arm_ob, names=None, deform_only=True):
    M = np.array(arm_ob.matrix_world)
    out = []
    for b in arm_ob.data.bones:
        if deform_only and not b.use_deform:
            continue
        if names is not None and b.name not in names:
            continue
        h = M[:3, :3] @ np.array(b.head_local) + M[:3, 3]
        t = M[:3, :3] @ np.array(b.tail_local) + M[:3, 3]
        out.append((b.name, h, t))
    return out


def seg_dist(P, a, b):
    ab = b - a
    L2 = max(float(ab @ ab), 1e-12)
    t = np.clip(((P - a) @ ab) / L2, 0.0, 1.0)
    C = a + t[:, None] * ab
    return np.linalg.norm(P - C, axis=1), C, t


def top_k(W, k=4, eps=1e-3):
    if W.shape[1] > k:
        idx = np.argsort(-W, axis=1)[:, k:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W[W < eps] = 0.0
    s = W.sum(axis=1, keepdims=True)
    bad = s[:, 0] <= 0
    s[bad] = 1.0
    return W / s, bad


LEG_PREFIXES = ("thigh_", "shin_", "foot_", "toe_", "metatarsal_")


def weights_sdf(P, segs, S=None, E=None, power=4.0, side_x=0.025, vis_tol=0.012, vis_k=5, penalty=3.5,
                smooth=4, floor=0.004):
    """Returns W (N, B) for bone segments `segs` [(name, head, tail)]."""
    N, B = len(P), len(segs)
    D = np.empty((N, B))
    CP = np.empty((N, B, 3))
    for j, (nm, a, b) in enumerate(segs):
        D[:, j], CP[:, j], _ = seg_dist(P, a, b)
        # side filter: torso-side bones may reach a little past the midline; leg bones never cross it
        sx = 0.0 if nm.startswith(LEG_PREFIXES) else side_x
        if nm.endswith("_L"):
            D[P[:, 0] < -sx, j] = np.inf
        elif nm.endswith("_R"):
            D[P[:, 0] > sx, j] = np.inf
    if S is not None and B > 1:
        order = np.argsort(D, axis=1)[:, :min(vis_k, B)]
        rows = np.arange(N)
        for kk in range(order.shape[1]):
            j = order[:, kk]
            C = CP[rows, j]
            worst = np.full(N, -1.0)
            for t in (0.25, 0.5, 0.75):
                Q = P + (C - P) * t
                d = np.concatenate([S.dist(Q[i:i + 60000]) for i in range(0, N, 60000)])
                worst = np.maximum(worst, d)
            bad = worst > vis_tol
            D[rows[bad], j[bad]] *= penalty
    W = np.where(np.isfinite(D), 1.0 / np.maximum(D, floor) ** power, 0.0)
    W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-30)
    if E is not None and smooth:
        for _ in range(smooth):
            W = 0.5 * W + 0.5 * nb_mean(E, W, N)
    W, _ = top_k(W, 4)
    return W


def apply_overrides(P, W, names, overrides):
    for fn, bone in overrides:
        if bone not in names:
            continue
        r = np.clip(fn(P), 0, 1)
        j = names.index(bone)
        W *= (1 - r)[:, None]
        W[:, j] += r
    W, _ = top_k(W, 4)
    return W


def make_rigid(W, groups):
    for g in groups:
        g = np.asarray(g)
        if len(g) == 0:
            continue
        avg = W[g].mean(axis=0)
        W[g] = avg
    W, _ = top_k(W, 4)
    return W


def write_groups(ob, names, W):
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for j, nm in enumerate(names):
        w = W[:, j]
        if (w > 0).any():
            meshutil.vertex_group_from_weights(ob, nm, w)


def read_groups(ob, names):
    """Current vertex-group weights as (N, B) for `names`."""
    N = len(ob.data.vertices)
    W = np.zeros((N, len(names)))
    gi = {vg.index: names.index(vg.name) for vg in ob.vertex_groups if vg.name in names}
    for v in ob.data.vertices:
        for g in v.groups:
            j = gi.get(g.group)
            if j is not None:
                W[v.index, j] = g.weight
    return W


def bind(ob, arm_ob):
    ob.parent = arm_ob
    ob.matrix_parent_inverse = arm_ob.matrix_world.inverted()
    m = ob.modifiers.get("Armature") or ob.modifiers.new("Armature", "ARMATURE")
    m.object = arm_ob
    m.use_vertex_groups = True
    m.use_deform_preserve_volume = False


def heat_weights(ob, arm_ob, names, max_reach=0.35):
    """Blender bone-heat; returns W or None if it failed validation."""
    meshutil.select_only([ob, arm_ob], arm_ob)
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception as e:
        log("bone heat failed:", e)
        return None
    W = read_groups(ob, names)
    s = W.sum(axis=1)
    if (s <= 1e-6).mean() > 0.001:
        log(f"bone heat: {(s <= 1e-6).sum()} unweighted verts -> fallback")
        return None
    P = meshutil.get_verts(ob, world=True)
    segs = bone_segments(arm_ob, names)
    for j, (nm, a, b) in enumerate(segs):
        d, _, _ = seg_dist(P, a, b)
        if ((W[:, j] > 0.2) & (d > max_reach)).any():
            log(f"bone heat: {nm} reaches too far -> fallback")
            return None
    W, _ = top_k(W, 4)
    return W


def skin(ob, arm_ob, method="sdf", S=None, allowed=None, overrides=(), rigid=(), power=4.0, smooth=4,
         vis_tol=0.012, penalty=3.5, post=None, restrict=True):
    """Weight `ob` to `arm_ob` and add the Armature modifier. Returns (names, W).
    Order: base weights (heat|sdf, restricted to `allowed` bones) -> post(P, names, W) hook (e.g. skirt_weights)
    -> overrides -> rigid groups -> anatomical restriction (restrict_adjacent) -> top-4 + normalise."""
    segs = bone_segments(arm_ob, allowed)
    names = [s[0] for s in segs]
    P = meshutil.get_verts(ob, world=True)
    E = edges_of(ob)
    W = None
    if method == "heat":
        W = heat_weights(ob, arm_ob, names)
        for m in list(ob.modifiers):
            if m.type == "ARMATURE":
                ob.modifiers.remove(m)
    if W is None:
        W = weights_sdf(P, segs, S=S, E=E, power=power, smooth=smooth, vis_tol=vis_tol, penalty=penalty)
        method = "sdf"
    if post is not None:
        W = post(P, names, W)
    if overrides:
        W = apply_overrides(P, W, names, overrides)
    if rigid:
        W = make_rigid(W, rigid)
    if restrict:
        W = restrict_adjacent(W, names)
    write_groups(ob, names, W)
    bind(ob, arm_ob)
    log(f"skin {ob.name}: {method}, {len(names)} bones, {len(P)} verts")
    return names, W


def rigid_components(ob, vert_mask):
    """Connected components (over mesh edges) of the vertices in vert_mask -> list of index arrays."""
    E = edges_of(ob)
    m = np.asarray(vert_mask, bool)
    E = E[m[E[:, 0]] & m[E[:, 1]]]
    n = len(m)
    parent = np.arange(n)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in E:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(n)])
    out = []
    ids = np.nonzero(m)[0]
    for r in np.unique(roots[ids]):
        g = ids[roots[ids] == r]
        if len(g) >= 3:
            out.append(g)
    return out


# ----------------------------------------------------------------------------- deformation QA
def pose_bones_char(arm_ob, pose):
    """Apply {bone: (x, y, z) degrees} rotations in CHARACTER space (see docs/ART_PIPELINE.md) to pose bones.
    Blender space: char +X forward = -Y, +Y up = +Z, +Z right = -X."""
    from mathutils import Euler, Matrix
    C = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))   # columns: char X,Y,Z axes in Blender coords
    arm_ob.data.pose_position = "POSE"
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    # parents first
    order = []

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)

    for b in arm_ob.pose.bones:
        if b.parent is None:
            walk(b)
    rest_world = {b.name: arm_ob.data.bones[b.name].matrix_local.to_3x3() for b in order}
    for pb in order:
        e = pose.get(pb.name)
        if not e:
            continue
        R_char = Euler([math.radians(a) for a in e], "XYZ").to_matrix()
        R = C @ R_char @ C.inverted()
        # local rotation so that (at the joint) the bone's world orientation = R * rest (parent at rest)
        Rb = rest_world[pb.name]
        pb.rotation_quaternion = (Rb.inverted() @ R @ Rb).to_quaternion()
    bpy.context.view_layer.update()


def debug_dominant(ob, bones=("hand_L", "hand_R", "forearm_L", "forearm_R"), zmax=0.9):
    """Log how many vertices each bone dominates and how many of those sit below `zmax` (QA helper)."""
    names = [vg.name for vg in ob.vertex_groups]
    W = read_groups(ob, names)
    if not len(names):
        log(f"[weights] {ob.name}: no groups")
        return
    top = np.argmax(W, axis=1)
    P = meshutil.get_verts(ob, world=True)
    out = {}
    for b in bones:
        if b in names:
            m = top == names.index(b)
            out[b] = (int(m.sum()), int((m & (P[:, 2] < zmax)).sum()))
    log(f"[weights] {ob.name}: {len(P)} verts, groups={len(names)} dominant(n, below {zmax})={out}")


# ----------------------------------------------------------------------------- anatomical validity
def _adjacency():
    A = {"hips": {"spine", "thigh_L", "thigh_R"}, "spine": {"hips", "chest"},
         "chest": {"spine", "neck", "clavicle_L", "clavicle_R", "upperarm_L", "upperarm_R"},
         "neck": {"chest", "head", "clavicle_L", "clavicle_R"}, "head": {"neck", "jaw"}, "jaw": {"head", "neck"}}
    for s in ("L", "R"):
        A.update({f"clavicle_{s}": {"chest", "neck", f"upperarm_{s}"},
                  f"upperarm_{s}": {f"clavicle_{s}", "chest", f"forearm_{s}"},
                  f"forearm_{s}": {f"upperarm_{s}", f"hand_{s}"}, f"hand_{s}": {f"forearm_{s}"},
                  f"thigh_{s}": {"hips", "spine", f"shin_{s}"}, f"shin_{s}": {f"thigh_{s}", f"foot_{s}"},
                  f"foot_{s}": {f"shin_{s}", f"toe_{s}"}, f"toe_{s}": {f"foot_{s}"}})
    return A


ADJ = _adjacency()
CHAIN_PARENTS = {"kilt": {"hips", "spine", "thigh_L", "thigh_R"}, "hair": {"head", "neck", "chest"},
                 "beard": {"jaw", "head"}, "cape": {"chest", "spine", "neck"}, "tail": {"hips", "spine"}}


def restrict_adjacent(W, names, adj=None, extra=None):
    """Anatomical validity: a vertex may only be influenced by its dominant bone and that bone's anatomical
    neighbours (ADJ; chains like hair_*/kilt_*/cape_*/tail_* may mix with their chain and parent).
    Kills e.g. hand weight on a thigh vertex or hand_L<->hand_R bleed, whatever the weighting method did."""
    adj = adj or ADJ
    idx = {n: i for i, n in enumerate(names)}
    B = len(names)
    allow = np.zeros((B, B), bool)
    for i, n in enumerate(names):
        allow[i, i] = True
        nb = set(adj.get(n, ()))
        pre = n.rsplit("_", 1)[0] if n[-1].isdigit() else None
        for m in names:
            if pre and m.startswith(pre.rstrip("_")):
                nb.add(m)
        for chain, parents in CHAIN_PARENTS.items():
            if n.startswith(chain + "_"):
                nb |= parents
        if extra and n in extra:
            nb |= set(extra[n])
        for m in nb:
            if m in idx:
                allow[i, idx[m]] = True
                allow[idx[m], i] = True
    dom = np.argmax(W, axis=1)
    W = W * allow[dom]
    W, _ = top_k(W, 4)
    return W


def skirt_weights(P, names, W_chain, top_z, hem_z, share=0.65, power=1.3, seam=0.05):
    """Kilts / skirts / tabards without secondary motion still have to clear the legs: blend the chain weights
    (hips + kilt_*) toward the thigh on the same side, from 0 at the waistband to `share` at the hem."""
    if "thigh_L" not in names or "thigh_R" not in names:
        return W_chain
    t = np.clip((top_z - 0.02 - P[:, 2]) / max(top_z - hem_z, 1e-6), 0, 1) ** power * share
    wl = np.clip((P[:, 0] + seam) / (2 * seam), 0, 1)
    wl = wl * wl * (3 - 2 * wl)
    W = W_chain * (1 - t)[:, None]
    W[:, names.index("thigh_L")] += t * wl
    W[:, names.index("thigh_R")] += t * (1 - wl)
    W, _ = top_k(W, 4)
    return W


# ----------------------------------------------------------------------------- deformation QA (Blender side)
TEST_POSES = {
    # character-space degrees (docs/ARCHITECTURE.md section 3: +Z swings a hanging limb forward, knee bend = -Z)
    "arms_down": {"upperarm_L": (-38, 0, 0), "upperarm_R": (38, 0, 0), "forearm_L": (0, 0, 20), "forearm_R": (0, 0, 20)},
    "reach": {"upperarm_L": (0, 0, 85), "upperarm_R": (0, 0, 85), "forearm_L": (0, 0, 45), "forearm_R": (0, 0, 45)},
    "overhead": {"upperarm_L": (70, 0, 40), "upperarm_R": (-70, 0, 40), "forearm_L": (0, 0, 60), "forearm_R": (0, 0, 60)},
    "kick": {"thigh_L": (0, 0, 75), "shin_L": (0, 0, -70), "thigh_R": (0, 0, -30), "shin_R": (0, 0, -20)},
    "crouch": {"thigh_L": (0, 0, 70), "thigh_R": (0, 0, 70), "shin_L": (0, 0, -110), "shin_R": (0, 0, -110),
               "foot_L": (0, 0, 35), "foot_R": (0, 0, 35), "spine": (0, 0, -20)},
    "twist": {"spine": (0, 25, 0), "chest": (0, 20, 0), "neck": (0, 20, -10), "head": (0, 25, 15)},
    "split": {"thigh_L": (35, 0, 40), "thigh_R": (-35, 0, -40), "shin_L": (0, 0, -40)},
}


def stretch_report(ob, arm_ob, poses=None, ratio=4.0, min_len=0.25, soft_ratio=2.5, soft_len=0.06):
    """Pose the armature in extreme test poses, evaluate the skinned mesh and count stretched edges (the same
    rule as the engine's __KCA.debug.skinCheck: > `ratio` x rest AND > `min_len` m) plus a stricter 'soft' count.
    Returns {pose: {'bad': n, 'soft': n, 'pairs': {...}}}. Leaves the armature in rest pose."""
    poses = poses or TEST_POSES
    E = edges_of(ob)
    P0 = meshutil.get_verts(ob, world=True)
    L0 = np.linalg.norm(P0[E[:, 0]] - P0[E[:, 1]], axis=1)
    names = [vg.name for vg in ob.vertex_groups]
    W = read_groups(ob, names)
    dom = np.argmax(W, axis=1)
    rep = {}
    for pname, pose in poses.items():
        pose_bones_char(arm_ob, pose)
        dg = bpy.context.evaluated_depsgraph_get()
        oe = ob.evaluated_get(dg)
        me = oe.to_mesh()
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        oe.to_mesh_clear()
        M = np.array(ob.matrix_world)
        P1 = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
        L1 = np.linalg.norm(P1[E[:, 0]] - P1[E[:, 1]], axis=1)
        bad = (L1 > ratio * L0) & (L1 > min_len)
        soft = (L1 > soft_ratio * L0) & (L1 > soft_len)
        pairs = {}
        for a, b in E[soft]:
            k = " <-> ".join(sorted((names[dom[a]], names[dom[b]])))
            pairs[k] = pairs.get(k, 0) + 1
        where = P0[E[bad].ravel()].mean(axis=0).round(3).tolist() if bad.any() else None
        rep[pname] = dict(bad=int(bad.sum()), soft=int(soft.sum()), where=where,
                          pairs=dict(sorted(pairs.items(), key=lambda kv: -kv[1])[:6]))
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    return rep
