"""Brann team pilot (C2 r19): the shared DONOR + PARTS interface.

Owner: the model LEAD. Specialists import this module and never edit it. If you need a change, write it in your
notes ("## Team pilot (r19)" in docs/notes/art-pipeline-brann.md) and the lead makes it.

Why this exists: the r18 GLB is ONE joined skinned mesh. Three Blender specialists change it in parallel, so nobody
re-imports, re-exports or re-orders the donor. Everybody reads the same canonical donor arrays straight from the GLB
(numpy, no Blender importer: stable vertex/triangle order), classifies triangles into named REGIONS the same way, and
hands back either a PART (new geometry that replaces whole regions) or EDITS (per-vertex moves / per-corner UVs and
normals on donor triangles, same topology). The integration build (blender/build_hero_brann_team.py) merges them.

Frames: every array here is BLENDER frame (Z up, character faces -Y, his LEFT is +X), metres. UVs are Blender
convention (v up). The glTF reader converts.

Run without Blender (no slot needed):
  ~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 -I blender/brann_team.py --probe
    -> progress/tmp/brann_team/donor/donor.json (hashes, region counts, UV boxes, face-chart density)
  ... blender/brann_team.py --check-part progress/tmp/brann_team/parts/<role>   (format + budget + bone audit)
"""
import hashlib
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEAM = os.path.join(ROOT, "progress", "tmp", "brann_team")
DONOR_DIR = os.path.join(TEAM, "donor")
PARTS_DIR = os.path.join(TEAM, "parts")
DONOR_GLB = os.path.join(DONOR_DIR, "hero_brann.glb")
DONOR_SHA = "2ab804c32cb6dc2a27a8a185dc54c8337a60e895315d8c1fff03846f24cefbac"   # r18 shipped (owner liked it)

# r18 export order (brann_groom.join_character over build_hero_brann `los`). Verified on the donor by --probe:
# every range has the expected UV box / dominant bones, so the split is exact, not heuristic.
PART_RANGES = [("body", 0, 21999), ("hand_L", 21999, 24399), ("hand_R", 24399, 26799), ("kilt", 26799, 30718),
               ("mane", 30718, 40934), ("pelt_L", 40934, 45934), ("pelt_R", 45934, 50934)]
HEAD_BOX = (np.array([-0.145, -0.155, 1.672]), np.array([0.145, 0.16, 2.01]))   # build_hero_brann.HEAD_BOX

CONFIG = {
    # ---- triangle budget (blueprint docs/notes/blueprints/hero_brann.md §Parts). Hard cap 75k; plan 69k.
    "budget": {"total_cap": 75000, "total_plan": 69000,
               "body_retained": 16900, "face": 9000, "mane": 16000, "pelts": 12000,
               "hands": 6000, "kilt": 4000, "gear_overlays": 5000},
    # ---- face edits (EDITS mode) limits, metres
    "face_edit": {"max_delta": 0.025, "scalp_max_delta": 0.002, "pinned_tol": 1e-6},
    # ---- texture tiles: name -> (sheet, x0, y0, x1, y1) in PIXELS of a 2048 sheet, origin bottom-left (Blender UV).
    # Specialists author each tile at exactly (x1-x0) x (y1-y0) px; part UVs are LOCAL to the tile (0..1).
    # The texture artist owns the final layout and may move a box, never shrink it without the owner of the tile.
    "sheets": {"body": {"material": "M_hero_brann", "res": 2048, "rim": None},            # rim: engine default
               "groom": {"material": "M_hero_brann_groom", "res": 2048, "rim": 0.14,     # hair + fur, low rim
                         "alpha": "MASK", "cutoff": 0.45}},
    "tiles": {
        "surface": ("body", 0, 0, 1424, 2048),      # donor body/hands/kilt charts, repacked TRANSLATION-ONLY
        "face":    ("body", 1456, 1456, 2032, 2032),  # 576 px: >= 3.5x the r18 face density (was ~1.05x)
        "gear":    ("body", 1456, 432, 2032, 1424),   # harness straps, disc + rings, bracer shells, buckles
        "spare":   ("body", 1456, 16, 2032, 400),     # texture artist's reserve (eyes/teeth may use it)
        "mane":    ("groom", 0, 0, 1264, 2048),       # strand lanes; cards may stack UVs on purpose
        "pelt":    ("groom", 1296, 704, 2048, 2048),  # shared by pelt_L/pelt_R (stacking expected)
        "furtrim": ("groom", 1296, 0, 2048, 672),     # boot tops / fur belt tufts (gear, optional)
    },
    "cleanup": {"degenerate_area": 1e-10, "debris_max_tris": 12, "float_m": 0.003},
}

# Region ownership. A PART may replace only regions listed for its role. EDITS only on the face role.
OWNERS = {
    "face": {"edit": ["face", "head_other", "scalp"], "replace": ["face"]},   # replace = Tier B only (seam audit)
    "hair": {"edit": [], "replace": ["mane"]},
    "gear": {"edit": [], "replace": ["pelt_L", "pelt_R", "hand_L", "hand_R", "kilt"]},
}
PART_ROLES = {"face": ["face_extra", "face_mesh"], "hair": ["mane"],
              "gear": ["pelts", "gear_overlays", "hands", "kilt"]}


# =============================================================================================== donor (numpy)
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_glb(path):
    """Minimal GLB reader for the skinned single-primitive donor. Returns glTF-frame arrays + json."""
    raw = open(path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    js = json.loads(raw[20:20 + n])
    off = 20 + n
    bl = struct.unpack_from("<I", raw, off)[0]
    buf = raw[off + 8:off + 8 + bl]
    CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        dt, nc = CT[a["componentType"]], NC[a["type"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        isz = np.dtype(dt).itemsize * nc
        st = bv.get("byteStride", 0)
        if st and st != isz:
            b = np.frombuffer(buf, np.uint8, a["count"] * st, o).reshape(a["count"], st)[:, :isz].copy()
            return b.view(dt).reshape(a["count"], nc)
        return np.frombuffer(buf, dt, a["count"] * nc, o).reshape(a["count"], nc).copy()

    if len(js["meshes"]) != 1 or len(js["meshes"][0]["primitives"]) != 1:
        raise ValueError("donor must be one mesh / one primitive (r18 layout)")
    pr = js["meshes"][0]["primitives"][0]
    at = pr["attributes"]
    out = dict(P=acc(at["POSITION"]), N=acc(at["NORMAL"]), UV=acc(at["TEXCOORD_0"]),
               J=acc(at["JOINTS_0"]).astype(np.int32), W=acc(at["WEIGHTS_0"]).astype(np.float32),
               F=acc(pr["indices"]).reshape(-1, 3).astype(np.int32))
    out["bones"] = [js["nodes"][j]["name"] for j in js["skins"][0]["joints"]]
    out["json"] = js
    return out


def to_blender(g):
    """glTF (Y up, +Z forward) -> Blender (Z up, -Y forward); v flipped."""
    P, N, UV = g["P"], g["N"], g["UV"]
    return (np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1).astype(np.float64),
            np.stack([N[:, 0], -N[:, 2], N[:, 1]], 1).astype(np.float32),
            np.stack([UV[:, 0], 1.0 - UV[:, 1]], 1).astype(np.float32))


class Donor:
    """Canonical donor arrays (Blender frame) + region labels per triangle. Same result for every caller."""

    def __init__(self, path=DONOR_GLB, check_sha=True):
        if check_sha and sha256(path) != DONOR_SHA:
            raise RuntimeError(f"donor {path} is not r18 ({DONOR_SHA[:12]}); snapshot it again")
        g = read_glb(path)
        self.path = path
        self.P, self.N, self.UVv = to_blender(g)
        self.F = g["F"]
        self.J, self.W = g["J"], g["W"]
        self.bones = g["bones"]
        self.Wn = np.zeros((len(self.P), len(self.bones)), np.float32)   # dense named weights (n, 40)
        np.add.at(self.Wn, (np.repeat(np.arange(len(self.P)), 4), self.J.ravel()), self.W.ravel())
        self.Wn /= np.maximum(self.Wn.sum(1, keepdims=True), 1e-8)
        self.UV = self.UVv[self.F]                     # (m,3,2) per corner, donor atlas coords
        self.NC = self.N[self.F]                       # (m,3,3) per corner normals
        self.pos_id = np.unique(np.round(self.P, 7), axis=0, return_inverse=True)[1].ravel()  # welded id per vertex
        self.region = self._classify()
        self.names = sorted(set(self.region))

    # ---------------------------------------------------------------- regions
    def _classify(self):
        m = len(self.F)
        reg = np.empty(m, object)
        if m != PART_RANGES[-1][2]:
            raise RuntimeError(f"donor has {m} tris, expected r18's {PART_RANGES[-1][2]}")
        for name, a, b in PART_RANGES:
            reg[a:b] = name
        self._verify_ranges(reg)
        # inside body: the face chart, the scalp chart (under the mane), other head bits (ears, head-box seams)
        body = np.flatnonzero(reg == "body")
        Fb = self.F[body]
        inbox = np.all((self.P[Fb] >= HEAD_BOX[0]) & (self.P[Fb] <= HEAD_BOX[1]), axis=(1, 2))
        isl = self._uv_islands(Fb)
        cen = self.P[Fb].mean(1)
        best = {}
        for side, sel in (("face", cen[:, 1] < 0), ("scalp", cen[:, 1] > 0)):
            ids, cnt = np.unique(isl[inbox & sel], return_counts=True)
            best[side] = ids[np.argmax(cnt)]
        reg[body[isl == best["face"]]] = "face"
        reg[body[(isl == best["scalp"])]] = "scalp"
        rest = inbox & (isl != best["face"]) & (isl != best["scalp"])
        reg[body[rest]] = "head_other"
        return reg

    def _verify_ranges(self, reg):
        U = self.UV
        for name, a, b in PART_RANGES:
            u = U[a:b]
            if name in ("mane", "pelt_L", "pelt_R"):
                ok = u[..., 0].min() > 0.84 and ((u[..., 1].max() < 0.63) if name == "mane" else (u[..., 1].min() > 0.63))
            else:
                ok = u[..., 0].max() < 0.83
            side = {"hand_L": 1, "pelt_L": 1, "hand_R": -1, "pelt_R": -1}.get(name)
            if side is not None:
                ok &= np.sign(self.P[self.F[a:b]][..., 0].mean()) == side
            if not ok:
                raise RuntimeError(f"donor range {name} [{a},{b}) failed its UV/side signature")

    def _uv_islands(self, Fsub):
        """Islands over glTF vertices (shared within a chart, split at seams)."""
        par = np.arange(len(self.P))

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        for f in Fsub:
            r = find(f[0])
            for v in f[1:]:
                par[find(v)] = r
        return np.array([find(f[0]) for f in Fsub])

    def faces(self, *names):
        return np.flatnonzero(np.isin(self.region, list(names)))

    def verts_of(self, *names):
        return np.unique(self.F[self.faces(*names)])

    def texel_density(self, names, res=2048):
        f = self.faces(*names)
        T = self.P[self.F[f]]
        a3 = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1).sum() * .5
        U = self.UV[f]
        a, b = U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]
        a2 = (np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) * .5).sum()
        return float(np.sqrt(a2 / max(a3, 1e-12)) * res), float(a3)

    def summary(self):
        out = {"glb": os.path.relpath(self.path, ROOT), "sha256": DONOR_SHA, "verts": len(self.P), "tris": len(self.F),
               "bones": self.bones, "regions": {}}
        for r in self.names:
            f = self.faces(r)
            U, Pp = self.UV[f], self.P[self.F[f]]
            d, a3 = self.texel_density([r])
            out["regions"][r] = {"tris": int(len(f)), "uv_box": [round(float(U[..., 0].min()), 4), round(float(U[..., 1].min()), 4),
                                                                round(float(U[..., 0].max()), 4), round(float(U[..., 1].max()), 4)],
                                 "z": [round(float(Pp[..., 2].min()), 4), round(float(Pp[..., 2].max()), 4)],
                                 "area_m2": round(a3, 5), "texel_px_per_m": round(d, 1)}
        out["pinned_for_face_edits"] = int(len(self.face_pinned_positions()))
        return out

    def face_pinned_positions(self):
        """Welded positions used by ANY triangle outside the face-edit regions: these may not move."""
        free = set(OWNERS["face"]["edit"])
        outside = np.flatnonzero(~np.isin(self.region, list(free)))
        return np.unique(self.pos_id[self.F[outside]].ravel())


# =============================================================================================== part files
PART_FORMAT = "kca-part-v1"


def save_part(dirpath, name, *, P, F, UV, N, W, bones, tile, meta):
    """One PART = new geometry for whole regions.  dirpath = progress/tmp/brann_team/parts/<role>/

    P (n,3) float  Blender frame metres, at the donor rig's rest pose and scale (feet z=0, faces -Y)
    F (m,3) int    triangles (outward winding)
    UV (m,3,2)     per-corner LOCAL tile coords in [0,1] (tile = CONFIG['tiles'] key; stacking allowed on groom tiles)
    N (m,3,3)      per-corner unit normals (you own your shading; integration copies them)
    W (n,k) float  weights over `bones` (names must be donor bones); integration keeps top-4, normalised
    meta: {"role","replaces":[regions],"author","notes", optional "alpha":True for cards on a MASK tile}
    Tiles: <dirpath>/tiles/<tile>_albedo.png (sRGB, RGBA if alpha), _orm.png, _normal.png at the tile's px size.
    """
    os.makedirs(dirpath, exist_ok=True)
    P, F, UV, N, W = (np.asarray(x) for x in (P, F, UV, N, W))
    assert P.ndim == 2 and P.shape[1] == 3 and F.shape[1] == 3 and UV.shape == (len(F), 3, 2) and N.shape == (len(F), 3, 3)
    assert W.shape[0] == len(P) and W.shape[1] == len(bones)
    np.savez_compressed(os.path.join(dirpath, name + ".npz"), P=P.astype(np.float32), F=F.astype(np.int32),
                        UV=UV.astype(np.float32), N=N.astype(np.float32), W=W.astype(np.float32),
                        bones=np.array(bones))
    meta = dict(meta, format=PART_FORMAT, name=name, tile=tile, tris=int(len(F)), verts=int(len(P)),
                donor_sha=DONOR_SHA)
    with open(os.path.join(dirpath, name + ".json"), "w") as f:
        json.dump(meta, f, indent=2)
    return meta


def load_part(dirpath, name):
    z = np.load(os.path.join(dirpath, name + ".npz"))
    meta = json.load(open(os.path.join(dirpath, name + ".json")))
    return dict(P=z["P"].astype(np.float64), F=z["F"], UV=z["UV"], N=z["N"], W=z["W"],
                bones=[str(b) for b in z["bones"]], meta=meta)


def save_edits(dirpath, *, vidx, P_new, fidx, UV, N, tile="face", meta=None):
    """EDITS on donor triangles (face role, Tier A). Same topology, same weights.

    vidx (k,) donor vertex indices moved, P_new (k,3) their new positions.
       Every donor vertex sharing a welded position with a moved one must be listed with the SAME new position
       (no cracks at UV seams). Positions used by triangles outside face/head_other/scalp may not move.
    fidx (j,) donor triangle indices (must be region 'face' [+ 'head_other' if you re-UV ears]) whose corners get
       UV (j,3,2) LOCAL face-tile coords and N (j,3,3) new corner normals. Untouched triangles keep donor UV/N,
       except that triangles touching a moved vertex get recomputed normals at integration unless listed here.
    """
    os.makedirs(dirpath, exist_ok=True)
    np.savez_compressed(os.path.join(dirpath, "edits.npz"), vidx=np.asarray(vidx, np.int32), P_new=np.asarray(P_new, np.float32),
                        fidx=np.asarray(fidx, np.int32), UV=np.asarray(UV, np.float32), N=np.asarray(N, np.float32))
    meta = dict(meta or {}, format=PART_FORMAT + "-edits", tile=tile, donor_sha=DONOR_SHA,
                moved=int(len(vidx)), reuv=int(len(fidx)))
    with open(os.path.join(dirpath, "edits.json"), "w") as f:
        json.dump(meta, f, indent=2)
    return meta


def load_edits(dirpath):
    p = os.path.join(dirpath, "edits.npz")
    if not os.path.exists(p):
        return None
    z = np.load(p)
    return {k: z[k] for k in z.files} | {"meta": json.load(open(os.path.join(dirpath, "edits.json")))}


# =============================================================================================== audits (numpy)
def audit_edits(D, E):
    """Face Tier-A audit: pinned positions unmoved, no cracks, scalp <= 2 mm, max delta, fidx regions."""
    cfg = CONFIG["face_edit"]
    issues = []
    newP = D.P.copy()
    newP[E["vidx"]] = E["P_new"]
    d = np.linalg.norm(newP - D.P, axis=1)
    pinned = np.isin(D.pos_id, D.face_pinned_positions())
    if (d[pinned] > cfg["pinned_tol"]).any():
        issues.append(f"{int((d[pinned] > cfg['pinned_tol']).sum())} pinned (neck/body/mane/pelt) vertices moved")
    # crack check: same donor welded position -> same new position
    key = D.pos_id
    order = np.argsort(key)
    k, P2 = key[order], newP[order]
    same = k[1:] == k[:-1]
    gap = np.linalg.norm(P2[1:] - P2[:-1], axis=1)
    if (same & (gap > 1e-6)).any():
        issues.append(f"{int((same & (gap > 1e-6)).sum())} seam cracks (split vertices moved differently)")
    # every position the scalp chart uses (incl. the hairline seam it shares with the face) holds the mane roots
    scalp_only = np.isin(D.pos_id, np.unique(D.pos_id[D.F[D.faces('scalp')]]))
    if (d[scalp_only] > cfg["scalp_max_delta"]).any():
        issues.append(f"scalp moved > {cfg['scalp_max_delta']*1000:.0f} mm at {int((d[scalp_only] > cfg['scalp_max_delta']).sum())} verts (mane roots)")
    if d.max() > cfg["max_delta"]:
        issues.append(f"max delta {d.max()*1000:.1f} mm > {cfg['max_delta']*1000:.0f} mm")
    bad = ~np.isin(D.region[E["fidx"]], ["face", "head_other"])
    if bad.any():
        issues.append(f"{int(bad.sum())} re-UV triangles outside face/head_other")
    if len(E["fidx"]) and (E["UV"].min() < 0 or E["UV"].max() > 1):
        issues.append("face UVs outside the local tile 0..1")
    return {"ok": not issues, "issues": issues, "max_delta_mm": round(float(d.max()) * 1000, 2),
            "moved": int((d > 1e-7).sum())}


def boundary_edges(F, P):
    """Open edges (used once) as sorted welded-position pairs."""
    pid = np.unique(np.round(P, 7), axis=0, return_inverse=True)[1].ravel()
    E = np.sort(np.concatenate([pid[F[:, [0, 1]]], pid[F[:, [1, 2]]], pid[F[:, [2, 0]]]]), axis=1)
    u, c = np.unique(E, axis=0, return_counts=True)
    return u[c == 1], pid


def audit_seam(D, replaced, part):
    """Tier-B replacement of a body-connected region: the part's open boundary must equal the hole's boundary."""
    keep = np.flatnonzero(~np.isin(D.region, replaced))
    hole = D.faces(*replaced)
    allP = np.concatenate([D.P, part["P"]])
    Fk, Fh = D.F[keep], D.F[hole]
    Fp = part["F"] + len(D.P)
    bk, pid = boundary_edges(np.concatenate([Fk, Fp]), allP)   # union must be closed where the hole was
    bh, _ = boundary_edges(np.concatenate([Fk, Fh]), allP)
    extra = len(bk) - len(bh)
    return {"ok": extra <= 0, "open_edges_after": int(len(bk)), "open_edges_donor": int(len(bh)),
            "new_open_edges": int(max(extra, 0))}


def check_part(dirpath):
    """Format / bones / weights / finiteness / UV range / budget per role. Prints and returns a report."""
    D_bones = None
    rep = {"dir": dirpath, "parts": {}, "ok": True}
    for fn in sorted(os.listdir(dirpath)):
        if not fn.endswith(".npz") or fn == "edits.npz":
            continue
        name = fn[:-4]
        p = load_part(dirpath, name)
        m = p["meta"]
        iss = []
        if D_bones is None:
            D_bones = read_glb(DONOR_GLB)["bones"]
        if not set(p["bones"]) <= set(D_bones):
            iss.append(f"unknown bones {sorted(set(p['bones']) - set(D_bones))}")
        if not np.isfinite(p["P"]).all() or not np.isfinite(p["W"]).all():
            iss.append("non-finite positions/weights")
        if (p["W"].sum(1) < 0.5).any():
            iss.append(f"{int((p['W'].sum(1) < .5).sum())} unweighted verts")
        if p["UV"].min() < 0 or p["UV"].max() > 1:
            iss.append("UV outside local tile")
        if m.get("tile") not in CONFIG["tiles"]:
            iss.append(f"unknown tile {m.get('tile')}")
        nl = np.linalg.norm(p["N"], axis=2)
        if (np.abs(nl - 1) > 1e-2).any():
            iss.append("non-unit corner normals")
        if p["P"][:, 2].min() < -1e-3:
            iss.append("geometry below the floor")
        rep["parts"][name] = {"tris": int(len(p["F"])), "replaces": m.get("replaces", []), "issues": iss}
        rep["ok"] &= not iss
    return rep


# =============================================================================================== Blender helpers
# Everything below needs bpy (run through tools/blender-run.mjs). Untested at planning time: the lead's first
# integration run and each specialist's first preview are their smoke tests. Report bugs; the lead fixes them.
def _bpy():
    import bpy  # noqa: F401
    sys.path.insert(0, HERE) if HERE not in sys.path else None
    from lib import meshutil, skin, pipeline
    return bpy, meshutil, skin, pipeline


def import_armature(glb=DONOR_GLB):
    """Import the donor only for its armature (bone rolls, sockets as exported). Mesh objects are deleted."""
    bpy, meshutil, _, _ = _bpy()
    meshutil.clear_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(glb))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    # r19 integration fix (hair/gear/face previews): the imported donor material kept the name M_hero_brann, so the
    # new body material became M_hero_brann.001 and patch_extras missed it (body lost kcaRimScale). Purge orphans.
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    return arm


def object_from_arrays(name, P, F, UV, N, W, bones, arm):
    """Mesh object with per-corner UV + custom normals + named groups, bound to `arm`."""
    _, meshutil, skin, _ = _bpy()
    ob = meshutil.mesh_from_numpy(name, np.asarray(P, np.float64), tris=np.asarray(F, np.int32))
    uv = ob.data.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", np.asarray(UV, np.float32).reshape(-1))
    ob.data.normals_split_custom_set(np.asarray(N, np.float32).reshape(-1, 3).tolist())
    Wk, _ = skin.top_k(np.asarray(W, np.float32), 4)
    skin.write_groups(ob, list(bones), Wk)
    skin.bind(ob, arm)
    return ob


def tile_to_sheet_uv(UV, tile):
    """LOCAL tile UV (0..1) -> sheet UV (0..1) for CONFIG['tiles'][tile]."""
    sheet, x0, y0, x1, y1 = CONFIG["tiles"][tile]
    res = CONFIG["sheets"][sheet]["res"]
    UV = np.asarray(UV, np.float32)
    return np.stack([(x0 + UV[..., 0] * (x1 - x0)) / res, (y0 + UV[..., 1] * (y1 - y0)) / res], -1)


def transfer_weights(P, D, regions=("body",), bones=None, k=3):
    """Weights for new geometry from the nearest donor SURFACE (barycentric on the nearest triangle).

    regions: donor regions to sample (e.g. ("body",) for harness/pelts, ("face","scalp","head_other") for eyes).
    bones: optional allow-list; others are zeroed and renormalised (e.g. pelts: clavicle_*, upperarm_*, chest).
    Returns (W (n, len(D.bones)), D.bones). Uses mathutils BVH (Blender) for exact nearest points.
    """
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    f = D.faces(*regions)
    T = D.F[f]
    bvh = BVHTree.FromPolygons([Vector(p) for p in D.P], T.tolist(), all_triangles=True)
    W = np.zeros((len(P), len(D.bones)), np.float32)
    for i, p in enumerate(np.asarray(P)):
        loc, _, idx, _ = bvh.find_nearest(Vector(p))
        tri = T[idx]
        a, b, c = D.P[tri]
        v0, v1, v2 = b - a, c - a, np.array(loc) - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = max(d00 * d11 - d01 * d01, 1e-12)
        w1 = (d11 * d20 - d01 * d21) / den
        w2 = (d00 * d21 - d01 * d20) / den
        bc = np.clip([1 - w1 - w2, w1, w2], 0, 1)
        W[i] = bc @ D.Wn[tri]
    if bones is not None:
        mask = np.isin(D.bones, list(bones))
        W[:, ~mask] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-8)
    return W, list(D.bones)


def donor_surface(D, drop_regions, edits=None):
    """Retained donor triangles as arrays (donor atlas UVs), with optional face EDITS applied."""
    keep = np.flatnonzero(~np.isin(D.region, list(drop_regions)))
    P = D.P.copy()
    UV = D.UV.copy()
    N = D.NC.copy()
    tile_of = np.full(len(D.F), "donor", object)
    if edits is not None:
        P[edits["vidx"]] = edits["P_new"]
        UV[edits["fidx"]] = edits["UV"]
        N[edits["fidx"]] = edits["N"]
        tile_of[edits["fidx"]] = edits["meta"].get("tile", "face")
    used = np.unique(D.F[keep])
    remap = np.full(len(D.P), -1, np.int64)
    remap[used] = np.arange(len(used))
    return dict(P=P[used], F=remap[D.F[keep]], UV=UV[keep], N=N[keep], W=D.Wn[used], bones=D.bones,
                tile_of=tile_of[keep], donor_faces=keep)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))


# =============================================================================================== CLI (no Blender)
if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if "--probe" in argv:
        D = Donor()
        s = D.summary()
        body_d, _ = D.texel_density(["body"])
        face_d, _ = D.texel_density(["face"])
        s["face_vs_body_density"] = round(face_d / body_d, 3)
        save_json(os.path.join(DONOR_DIR, "donor.json"), s)
        print(json.dumps({k: v for k, v in s.items() if k != "bones"}, indent=1))
    elif "--check-part" in argv:
        d = argv[argv.index("--check-part") + 1]
        r = check_part(d)
        e = load_edits(d)
        if e is not None:
            r["edits"] = audit_edits(Donor(), e)
            r["ok"] &= r["edits"]["ok"]
        print(json.dumps(r, indent=1))
        sys.exit(0 if r["ok"] else 1)
    else:
        print(__doc__)
