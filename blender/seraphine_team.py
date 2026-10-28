"""Seraphine team (C2 r24): the shared DONOR + PARTS + RETARGET interface.

Owner: the model LEAD. Specialists import this module and never edit it. Need a change? Write it in your notes
(docs/notes/hero-seraphine.md "## Team round (r24)") and work around it in YOUR module until the lead fixes it.

Pattern = Brann r19 (blender/brann_team.py: part-edit on a frozen donor), extended for Seraphine:
  * the donor has TWO skinned meshes: "body" (M_hero_seraphine, 36,890 tris) and "groom" (M_hero_seraphine_hair,
    34,950 tris, MASK alpha cards). Every array is per mesh: D.mesh["body"], D.mesh["groom"].
  * proportions change (the board's "stocky" complaint), so the BODY role also ships a RETARGET (retarget.json):
    per-bone scale along / across the bone axis. Integration maps every vertex (donor AND every part, through its
    skin weights) and every rest joint with the SAME linear-blend map, then re-grounds the feet. Bone directions and
    rolls never change (scales only, no rotations), so every clip (rotations) still plays; only joint offsets move.
    The r18 builder did the same thing by hand (build_hero_seraphine.dancer_points: legs +40 mm, shoulders -5.5 %,
    thighs/greaves -12 %, head +4 %).
  * Face and hair author in the DONOR rest frame (un-retargeted). The head is mapped rigidly (head bone: uniform
    scale + translation), so their work follows the new body exactly.

Frames: BLENDER frame (Z up, she faces -Y, her LEFT = +X), metres. UVs Blender convention (v up).

No Blender needed (no slot):
  PY=~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13
  $PY -I blender/seraphine_team.py --probe                 -> progress/tmp/seraphine_team/donor/donor.json (+ maps)
  $PY -I blender/seraphine_team.py --check-part <parts/role>   (format, budget, bones, edits audit, retarget dry-run)
  $PY -I blender/seraphine_team.py --retarget-report <retarget.json>   (joint moves, heights, widths, max deltas)
"""
import hashlib
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEAM = os.path.join(ROOT, "progress", "tmp", "seraphine_team")
DONOR_DIR = os.path.join(TEAM, "donor")
PARTS_DIR = os.path.join(TEAM, "parts")
DONOR_GLB = os.path.join(DONOR_DIR, "hero_seraphine.glb")
DONOR_SHA = "1921b3a7d5e007959f8a7a0295225a2d8bc89641fb640d1497409bf57f026d02"   # r18 shipped (SHA in hero-seraphine.md)
MESHES = {"hero_seraphine_mesh": "body", "hero_seraphine_hair": "groom"}
HEAD_BOX = (np.array([-0.15, -0.16, 1.53]), np.array([0.15, 0.17, 1.80]))   # r18 frame (after dancer_fit)

CONFIG = {
    # ---- triangle budget (blueprint docs/notes/blueprints/hero_seraphine.md §Parts). Cap 75k; plan <= 72k.
    "budget": {"total_cap": 75000, "total_plan": 72000,
               "face": 11000,            # head region (donor ~9k incl. ears/nape) + eyes/lids
               "groom": 34000,           # whole groom (donor 34,950 incl. 15k plait) + braid tip
               "body": 30000},           # torso/arms/legs/hands/skirt/sash (donor ~27.8k ex. head)
    "face_edit": {"max_delta": 0.020, "cranium_max_delta": 0.002, "cranium_band": 0.012, "pinned_tol": 1e-6},
    "body_edit": {"max_delta": 0.030, "pinned_tol": 1e-6},
    "retarget": {"min": 0.75, "max": 1.30},
    # ---- texture tiles: name -> (sheet, x0, y0, x1, y1) px on a 2048 sheet, origin bottom-left (Blender UV).
    # Roles author each tile at exactly (x1-x0) x (y1-y0) px; part UVs are LOCAL to the tile (0..1).
    # "donor_body" / "donor_groom" = keep the donor atlas UVs unchanged (no tile PNG needed).
    # The texture artist owns the final layout (repack of the donor charts into "surface") and may move a box,
    # never shrink one without its owner.
    "sheets": {"body": {"material": "M_hero_seraphine", "res": 2048, "rim": None},
               "groom": {"material": "M_hero_seraphine_hair", "res": 2048, "rim": 0.025, "alpha": "MASK",
                         "cutoff": 0.4, "specular": 0.06}},
    "tiles": {
        "surface": ("body", 0, 0, 1360, 2048),        # retained donor charts, repacked TRANSLATION-ONLY (texture)
        "face":    ("body", 1392, 1328, 2032, 2032),  # 640x704: face + ears re-UV (face role), >= donor density
        "outfit":  ("body", 1392, 400, 2032, 1296),   # 640x896: new body/outfit pieces (wraps, greaves, sash ends)
        "spare":   ("body", 1392, 16, 2032, 368),     # texture artist reserve (eye/teeth detail, paint)
        "groom":   ("groom", 0, 0, 2048, 2048),       # the whole hair sheet belongs to the hair role
    },
}

# Region ownership. EDITS move donor vertices (same topology/weights); PARTS replace whole regions.
OWNERS = {
    "face": {"mesh": "body", "edit": ["head"], "replace": ["eyes"]},
    "hair": {"mesh": "groom", "edit": [], "replace": ["scalp_shell", "locks", "wisps", "braid", "metal", "braid_tip"]},
    "body": {"mesh": "body", "edit": ["torso", "arm_L", "arm_R", "leg_L", "leg_R", "hand_L", "hand_R", "skirt",
                                      "sash_tails"],
             "replace": ["torso", "arm_L", "arm_R", "leg_L", "leg_R", "hand_L", "hand_R", "skirt", "sash_tails"]},
}
ROLES = tuple(OWNERS)
HAIR_BONES = ["head", "hair_1", "hair_2", "hair_3", "hair_4", "hair_5"]
NOT_FOR_HAIR = ("clavicle", "upperarm", "forearm", "hand", "chest", "spine", "neck")   # braid-along-arm bug


# =============================================================================================== GLB io (numpy)
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _parse(path):
    raw = open(path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    js = json.loads(raw[20:20 + n])
    off = 20 + n
    bl = struct.unpack_from("<I", raw, off)[0]
    return js, raw[off + 8:off + 8 + bl]


def _accessor(js, buf, i):
    CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
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


def g2b(P):
    """glTF (Y up, +Z forward) -> Blender (Z up, -Y forward)."""
    P = np.asarray(P, np.float64)
    return np.stack([P[..., 0], -P[..., 2], P[..., 1]], -1)


def _quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def _node_world(js):
    """World 4x4 per node (glTF frame) from TRS / matrix."""
    nodes = js["nodes"]
    parent = {c: i for i, nd in enumerate(nodes) for c in nd.get("children", [])}
    local = []
    for nd in nodes:
        if "matrix" in nd:
            local.append(np.array(nd["matrix"], float).reshape(4, 4).T)
            continue
        M = np.eye(4)
        M[:3, :3] = _quat_mat(nd.get("rotation", [0, 0, 0, 1])) * np.array(nd.get("scale", [1, 1, 1]))
        M[:3, 3] = nd.get("translation", [0, 0, 0])
        local.append(M)
    world = [None] * len(nodes)

    def w(i):
        if world[i] is None:
            world[i] = (w(parent[i]) @ local[i]) if i in parent else local[i]
        return world[i]
    for i in range(len(nodes)):
        w(i)
    return world, parent


class Mesh:
    """One donor primitive in canonical order (Blender frame) + dense named weights + regions per triangle."""

    def __init__(self, js, buf, mesh_index, bones):
        pr = js["meshes"][mesh_index]["primitives"][0]
        at = pr["attributes"]
        self.name = js["meshes"][mesh_index]["name"]
        self.material = js["materials"][pr["material"]]["name"]
        self.P = g2b(_accessor(js, buf, at["POSITION"]))
        self.N = g2b(_accessor(js, buf, at["NORMAL"])).astype(np.float32)
        uv = _accessor(js, buf, at["TEXCOORD_0"]).astype(np.float32)
        self.UVv = np.stack([uv[:, 0], 1.0 - uv[:, 1]], 1)
        self.J = _accessor(js, buf, at["JOINTS_0"]).astype(np.int32)
        self.W = _accessor(js, buf, at["WEIGHTS_0"]).astype(np.float32)
        self.F = _accessor(js, buf, pr["indices"]).reshape(-1, 3).astype(np.int32)
        self.bones = bones
        self.Wn = np.zeros((len(self.P), len(bones)), np.float32)
        np.add.at(self.Wn, (np.repeat(np.arange(len(self.P)), 4), self.J.ravel()), self.W.ravel())
        self.Wn /= np.maximum(self.Wn.sum(1, keepdims=True), 1e-8)
        self.UV = self.UVv[self.F]
        self.NC = self.N[self.F]
        self.pos_id = np.unique(np.round(self.P, 7), axis=0, return_inverse=True)[1].ravel()
        self.comp = self._components()
        self.region = None

    def _components(self):
        """Connected components per triangle over WELDED positions (UV seams do not split a part)."""
        pid = self.pos_id
        par = np.arange(pid.max() + 1)

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        for f in pid[self.F]:
            r = find(f[0])
            for v in f[1:]:
                rv = find(v)
                if rv != r:
                    par[rv] = r
        return np.array([find(f[0]) for f in pid[self.F]])

    def tri_bone(self):
        """Dominant bone name per triangle (summed weights of its 3 corners)."""
        s = self.Wn[self.F].sum(1)
        return np.array(self.bones)[s.argmax(1)]

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


class Donor:
    """Canonical r18 donor: D.mesh['body'|'groom'] (Mesh), D.bones, D.joints (rest heads, Blender frame),
    D.parent (bone -> parent bone name or None), D.json. Same result for every caller."""

    def __init__(self, path=DONOR_GLB, check_sha=True):
        if check_sha and sha256(path) != DONOR_SHA:
            raise RuntimeError(f"donor {path} is not r18 ({DONOR_SHA[:12]}); re-snapshot it from git (83f2fde)")
        js, buf = _parse(path)
        self.path, self.json = path, js
        skin = js["skins"][0]
        self.bones = [js["nodes"][j]["name"] for j in skin["joints"]]
        world, parent = _node_world(js)
        nid = {js["nodes"][j]["name"]: j for j in skin["joints"]}
        self.joints = {b: g2b(world[nid[b]][:3, 3]) for b in self.bones}
        self.parent = {}
        for b in self.bones:
            p = parent.get(nid[b])
            self.parent[b] = js["nodes"][p]["name"] if p is not None and js["nodes"][p]["name"] in nid else None
        self.mesh = {}
        for i, m in enumerate(js["meshes"]):
            key = MESHES.get(m["name"])
            if key is None:
                raise RuntimeError(f"unexpected mesh {m['name']} in donor")
            self.mesh[key] = Mesh(js, buf, i, self.bones)
        self._classify()

    # ---------------------------------------------------------------- regions
    def _classify(self):
        """Regions (verified on the r18 donor by --probe; see donor.json):
        body mesh : head, torso, arm_L, arm_R, leg_L, leg_R (main fused surface split by dominant bone),
                    hand_L, hand_R, skirt (tasset kilt), sash_tails, eyes (2 hidden inverted spheres), braid_tip
        groom mesh: scalp_shell (largest), braid (hair_* dominant), metal (circlet + sun-disc + cuffs: UV u>.75,
                    v<.12), wisps (UV u>.75, v>.16), locks (everything else)."""
        B = self.mesh["body"]
        reg = np.empty(len(B.F), object)
        tb = B.tri_bone()
        ids, cnt = np.unique(B.comp, return_counts=True)
        main = ids[np.argmax(cnt)]
        for c in ids:
            sel = B.comp == c
            P = B.P[B.F[sel]].reshape(-1, 3)
            bset = set(tb[sel])
            lo, hi = P.min(0), P.max(0)
            if c == main:
                continue
            if all(b.startswith("hair_") for b in bset):
                reg[sel] = "braid_tip"
            elif bset <= {"hand_L", "forearm_L"} and lo[0] > 0:
                reg[sel] = "hand_L"
            elif bset <= {"hand_R", "forearm_R"} and hi[0] < 0:
                reg[sel] = "hand_R"
            elif np.all(lo >= HEAD_BOX[0]) and np.all(hi <= HEAD_BOX[1]) and (hi - lo).max() < 0.04:
                reg[sel] = "eyes"
            elif sel.sum() > 1500:
                reg[sel] = "skirt"
            else:
                reg[sel] = "sash_tails"
        m = B.comp == main
        side = lambda b: b[-1]  # noqa: E731
        for i in np.flatnonzero(m):
            b = tb[i]
            if b == "head":
                reg[i] = "head"
            elif b.startswith(("upperarm", "forearm", "hand")):
                reg[i] = "arm_" + side(b)
            elif b.startswith(("thigh", "shin", "foot", "toe")):
                reg[i] = "leg_" + side(b)
            else:
                reg[i] = "torso"
        B.region = reg
        G = self.mesh["groom"]
        reg = np.empty(len(G.F), object)
        ids, cnt = np.unique(G.comp, return_counts=True)
        scalp = ids[np.argmax(cnt)]
        tb = G.tri_bone()
        u = G.UV.mean(1)
        for c in ids:
            sel = G.comp == c
            if c == scalp:
                reg[sel] = "scalp_shell"
            elif (u[sel, 0] > 0.75).all() and (u[sel, 1] < 0.12).all():
                reg[sel] = "metal"
            elif (u[sel, 0] > 0.75).all() and (u[sel, 1] > 0.16).all():
                reg[sel] = "wisps"
            elif np.mean([b.startswith("hair_") for b in tb[sel]]) > 0.5:
                reg[sel] = "braid"
            else:
                reg[sel] = "locks"
        G.region = reg

    def region_of(self, name):
        for k, M in self.mesh.items():
            if name in set(M.region):
                return k
        raise KeyError(name)

    def pinned_positions(self, role):
        """Welded body-mesh positions an EDIT by `role` may not move: used by any triangle outside its edit regions."""
        B = self.mesh["body"]
        free = set(OWNERS[role]["edit"])
        outside = np.flatnonzero(~np.isin(B.region, list(free)))
        return np.unique(B.pos_id[B.F[outside]].ravel())

    def cranium_vertices(self):
        """Head-region vertices under the groom scalp shell (within cranium_band): face edits move them <= 2 mm."""
        B, G = self.mesh["body"], self.mesh["groom"]
        hv = B.verts_of("head")
        S = G.P[G.verts_of("scalp_shell")]
        d = np.full(len(hv), np.inf)
        for a in range(0, len(S), 512):
            d = np.minimum(d, np.linalg.norm(B.P[hv][:, None] - S[None, a:a + 512], axis=2).min(1))
        return hv[d < CONFIG["face_edit"]["cranium_band"]]

    def summary(self):
        out = {"glb": os.path.relpath(self.path, ROOT), "sha256": DONOR_SHA, "bones": self.bones,
               "parent": self.parent, "joints": {b: [round(float(x), 4) for x in p] for b, p in self.joints.items()},
               "meshes": {}}
        for k, M in self.mesh.items():
            rr = {}
            for r in sorted(set(M.region)):
                f = M.faces(r)
                U, Pp = M.UV[f], M.P[M.F[f]]
                d, a3 = M.texel_density([r])
                rr[r] = {"tris": int(len(f)), "parts": int(len(np.unique(M.comp[f]))),
                         "uv_box": [round(float(U[..., 0].min()), 4), round(float(U[..., 1].min()), 4),
                                    round(float(U[..., 0].max()), 4), round(float(U[..., 1].max()), 4)],
                         "bbox_min": [round(float(x), 4) for x in Pp.reshape(-1, 3).min(0)],
                         "bbox_max": [round(float(x), 4) for x in Pp.reshape(-1, 3).max(0)],
                         "area_m2": round(a3, 5), "texel_px_per_m": round(d, 1)}
            out["meshes"][k] = {"name": M.name, "material": M.material, "verts": len(M.P), "tris": len(M.F),
                                "regions": rr}
        out["cranium_vertices"] = int(len(self.cranium_vertices()))
        return out


# =============================================================================================== part files
PART_FORMAT = "kca-part-v1"


def save_part(dirpath, name, *, P, F, UV, N, W, bones, tile, meta):
    """One PART = new geometry. dirpath = progress/tmp/seraphine_team/parts/<role>/

    P (n,3)     Blender frame metres, DONOR rest pose (un-retargeted; integration applies the retarget)
    F (m,3)     triangles (outward winding)
    UV (m,3,2)  per-corner LOCAL tile coords [0,1] (tile = CONFIG['tiles'] key or "donor_body"/"donor_groom" = sheet UVs)
    N (m,3,3)   per-corner unit normals
    W (n,k)     weights over `bones` (donor bone names); integration keeps top-4, normalised
    meta: {"role", "mesh": "body"|"groom", "replaces": [regions], "notes", optional "alpha": True}
    Tiles: <dirpath>/tiles/<tile>_albedo.png (sRGB; RGBA on the groom sheet), _orm.png, _normal.png at the tile size.
    """
    os.makedirs(dirpath, exist_ok=True)
    P, F, UV, N, W = (np.asarray(x) for x in (P, F, UV, N, W))
    assert P.ndim == 2 and P.shape[1] == 3 and F.shape[1] == 3 and UV.shape == (len(F), 3, 2) and N.shape == (len(F), 3, 3)
    assert W.shape == (len(P), len(bones))
    assert meta.get("mesh") in ("body", "groom"), "meta['mesh'] must be 'body' or 'groom'"
    np.savez_compressed(os.path.join(dirpath, name + ".npz"), P=P.astype(np.float32), F=F.astype(np.int32),
                        UV=UV.astype(np.float32), N=N.astype(np.float32), W=W.astype(np.float32), bones=np.array(bones))
    meta = dict(meta, format=PART_FORMAT, name=name, tile=tile, tris=int(len(F)), verts=int(len(P)), donor_sha=DONOR_SHA)
    save_json(os.path.join(dirpath, name + ".json"), meta)
    return meta


def load_part(dirpath, name):
    z = np.load(os.path.join(dirpath, name + ".npz"))
    meta = json.load(open(os.path.join(dirpath, name + ".json")))
    return dict(P=z["P"].astype(np.float64), F=z["F"], UV=z["UV"], N=z["N"], W=z["W"],
                bones=[str(b) for b in z["bones"]], meta=meta)


def list_parts(dirpath):
    if not os.path.isdir(dirpath):
        return []
    return sorted(fn[:-4] for fn in os.listdir(dirpath) if fn.endswith(".npz") and fn != "edits.npz")


def save_edits(dirpath, *, vidx, P_new, fidx=(), UV=None, N=None, tile="face", meta=None):
    """EDITS on donor BODY-mesh triangles (face and body roles). Same topology, same weights.

    vidx (k,) body-mesh vertex indices moved, P_new (k,3) their new DONOR-frame positions. Every vertex sharing a
       welded position with a moved one must get the SAME position (no cracks). Pinned positions (used by triangles
       outside your edit regions) may not move: the head/neck seam is pinned for BOTH roles (the retarget moves it).
    fidx (j,) triangles (your edit regions) whose corners get UV (j,3,2) LOCAL `tile` coords and N (j,3,3) normals.
       Other triangles keep donor UV/N; triangles touching a moved vertex get recomputed normals at integration.
    """
    os.makedirs(dirpath, exist_ok=True)
    fidx = np.asarray(fidx, np.int32)
    UV = np.zeros((0, 3, 2), np.float32) if UV is None else np.asarray(UV, np.float32)
    N = np.zeros((0, 3, 3), np.float32) if N is None else np.asarray(N, np.float32)
    np.savez_compressed(os.path.join(dirpath, "edits.npz"), vidx=np.asarray(vidx, np.int32),
                        P_new=np.asarray(P_new, np.float32), fidx=fidx, UV=UV, N=N)
    meta = dict(meta or {}, format=PART_FORMAT + "-edits", mesh="body", tile=tile, donor_sha=DONOR_SHA,
                moved=int(len(vidx)), reuv=int(len(fidx)))
    save_json(os.path.join(dirpath, "edits.json"), meta)
    return meta


def load_edits(dirpath):
    p = os.path.join(dirpath, "edits.npz")
    if not os.path.exists(p):
        return None
    z = np.load(p)
    return {k: z[k] for k in z.files} | {"meta": json.load(open(os.path.join(dirpath, "edits.json")))}


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


# =============================================================================================== retarget
def load_retarget(path=None):
    """retarget.json (body role):
    {"bones": {"<bone>": {"len": s, "w": s, "d": s}, ...},   # along the bone / lateral / depth, about the bone head
     "ground": true, "notes": ".."}
    Unlisted bones = 1. `len` stretches the bone toward its child joints (legs longer); `w`/`d` slim the flesh around
    the bone axis (thigh 0.9 = 10 % slimmer). Head: give len = w = d (uniform) or the face distorts.
    Limits CONFIG['retarget'] (0.75 .. 1.30)."""
    path = path or os.path.join(PARTS_DIR, "body", "retarget.json")
    if not os.path.exists(path):
        return None
    return json.load(open(path))


def bone_frames(D):
    """Per bone: head (3,), axis (unit, toward the mean of its child joints; leaf: the parent's axis), lateral, depth.
    Built from joint positions only, so it does not depend on exporter bone-axis conventions."""
    kids = {b: [c for c in D.bones if D.parent[c] == b] for b in D.bones}
    fr = {}
    for b in D.bones:            # skin joint order is parent-before-child in our exporter; fixed up below if not
        h = D.joints[b]
        ks = [D.joints[c] for c in kids[b] if not c.startswith(("socket_", "kilt_", "hair_")) or b.startswith(("kilt", "hair"))]
        if not ks:
            ks = [D.joints[c] for c in kids[b]]
        if ks:
            a = np.mean(ks, 0) - h
        elif D.parent[b] is not None:
            a = h - D.joints[D.parent[b]]
        else:
            a = np.array([0, 0, 1.0])
        if np.linalg.norm(a) < 1e-6:
            a = np.array([0, 0, 1.0])
        a = a / np.linalg.norm(a)
        lat = np.array([1.0, 0, 0]) - a * a[0]
        if np.linalg.norm(lat) < 1e-3:
            lat = np.array([0, 1.0, 0]) - a * a[1]
        lat /= np.linalg.norm(lat)
        dep = np.cross(a, lat)
        fr[b] = dict(head=h, axis=a, lat=lat, dep=dep)
    return fr


def retarget_maps(D, spec):
    """Per bone affine x -> new_head + A (x - old_head). new_head = parent's map of the old head (top-down)."""
    fr = bone_frames(D)
    lim = CONFIG["retarget"]
    sb = (spec or {}).get("bones", {})
    for b, s in sb.items():
        if b not in D.joints:
            raise ValueError(f"retarget: unknown bone {b}")
        for k in ("len", "w", "d"):
            if not (lim["min"] <= float(s.get(k, 1.0)) <= lim["max"]):
                raise ValueError(f"retarget: {b}.{k}={s.get(k)} outside {lim}")
    maps = {}

    def get(b):
        if b in maps:
            return maps[b]
        f, s = fr[b], sb.get(b, {})
        R = np.stack([f["axis"], f["lat"], f["dep"]], 1)              # columns = bone frame in world
        A = R @ np.diag([float(s.get("len", 1)), float(s.get("w", 1)), float(s.get("d", 1))]) @ R.T
        p = D.parent[b]
        nh = f["head"].copy() if p is None else apply_map(get(p), f["head"][None])[0]
        maps[b] = dict(old=f["head"], new=nh, A=A)
        return maps[b]
    for b in D.bones:
        get(b)
    return maps


def apply_map(m, X):
    return m["new"] + (np.asarray(X, np.float64) - m["old"]) @ m["A"].T


def ground_offset(D, maps):
    """dz that puts the retargeted lowest body vertex back at the donor's floor (feet flat on z=0)."""
    B = D.mesh["body"]
    feet = B.verts_of("leg_L", "leg_R")
    Q = blend_points(B.P[feet], B.Wn[feet], D.bones, maps)
    return float(B.P[feet, 2].min() - Q[:, 2].min())


def blend_points(P, Wn, bones, maps, dz=0.0):
    """Linear-blend retarget of points with dense weights Wn (n, len(bones))."""
    out = np.zeros((len(P), 3))
    for j, b in enumerate(bones):
        w = Wn[:, j]
        nz = w > 0
        if nz.any():
            out[nz] += w[nz, None] * apply_map(maps[b], P[nz])
    s = Wn.sum(1, keepdims=True)
    out = np.where(s > 1e-8, out / np.maximum(s, 1e-8), P)
    out[:, 2] += dz
    return out


def blend_normals(N, Wv, bones, maps):
    """Normals under the blended linear part: inverse-transpose of sum_j w_j A_j. N (n,3) per vertex, Wv (n,k)."""
    A = np.zeros((len(N), 3, 3))
    for j, b in enumerate(bones):
        w = Wv[:, j]
        nz = w > 0
        if nz.any():
            A[nz] += w[nz, None, None] * maps[b]["A"][None]
    A[Wv.sum(1) < 1e-8] = np.eye(3)
    M = np.linalg.inv(A).transpose(0, 2, 1)
    out = np.einsum("nij,nj->ni", M, N)
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)


def dense_weights(W, bones_from, bones_to):
    """Re-index a part's (n,k) weights over its own bone list onto the donor bone order."""
    out = np.zeros((len(W), len(bones_to)), np.float32)
    for j, b in enumerate(bones_from):
        out[:, bones_to.index(b)] += W[:, j]
    return out


def retarget_report(D, spec):
    maps = retarget_maps(D, spec)
    dz = ground_offset(D, maps) if (spec or {}).get("ground", True) else 0.0
    new = {b: maps[b]["new"] + ([0, 0, 0] if D.parent[b] is None else [0, 0, dz]) for b in D.bones}
    B = D.mesh["body"]
    Q = blend_points(B.P, B.Wn, D.bones, maps, dz)
    d = np.linalg.norm(Q - B.P, axis=1)

    def width(P, z0, z1):
        s = (P[:, 2] > z0) & (P[:, 2] < z1)
        return float(P[s, 0].max() - P[s, 0].min()) if s.any() else None
    j = D.joints
    rep = {"dz_ground": round(dz, 4),
           "height": [round(float(B.P[:, 2].max()), 4), round(float(Q[:, 2].max()), 4)],
           "max_vertex_move_m": round(float(d.max()), 4),
           "joints_moved_mm": {b: round(float(np.linalg.norm(new[b] - j[b]) * 1000), 1) for b in D.bones
                               if np.linalg.norm(new[b] - j[b]) > 5e-4},
           "leg_len_hip_to_ankle": [round(float(j["thigh_L"][2] - j["foot_L"][2]), 4),
                                    round(float(new["thigh_L"][2] - new["foot_L"][2]), 4)],
           "shoulder_span": [round(float(j["upperarm_L"][0] - j["upperarm_R"][0]), 4),
                             round(float(new["upperarm_L"][0] - new["upperarm_R"][0]), 4)]}
    hz = j["head"][2]
    rep["head_height_ratio"] = [round(float(B.P[:, 2].max() / (B.P[:, 2].max() - hz + 0.07)), 2),
                                round(float(Q[:, 2].max() / (Q[:, 2].max() - new["head"][2] + 0.07)), 2)]
    for nm, z0, z1 in (("thigh_width_z0.75", 0.70, 0.80), ("calf_width_z0.35", 0.30, 0.40)):
        sel = B.faces("leg_L")
        P0 = B.P[np.unique(B.F[sel])]
        P1 = Q[np.unique(B.F[sel])]
        rep[nm] = [width(P0, z0, z1), width(P1, z0, z1)]
    return rep


# =============================================================================================== audits
def audit_edits(D, E, role):
    cfg = CONFIG["face_edit" if role == "face" else "body_edit"]
    B = D.mesh["body"]
    issues = []
    newP = B.P.copy()
    newP[E["vidx"]] = E["P_new"]
    d = np.linalg.norm(newP - B.P, axis=1)
    pinned = np.isin(B.pos_id, D.pinned_positions(role))
    if (d[pinned] > cfg["pinned_tol"]).any():
        issues.append(f"{int((d[pinned] > cfg['pinned_tol']).sum())} pinned vertices moved (outside {role} regions)")
    order = np.argsort(B.pos_id)
    k, P2 = B.pos_id[order], newP[order]
    same = k[1:] == k[:-1]
    if (same & (np.linalg.norm(P2[1:] - P2[:-1], axis=1) > 1e-6)).any():
        issues.append("seam cracks: split copies of one welded position moved differently")
    if role == "face":
        cr = D.cranium_vertices()
        if (d[cr] > cfg["cranium_max_delta"]).any():
            issues.append(f"cranium (under the groom) moved > {cfg['cranium_max_delta']*1000:.0f} mm at "
                          f"{int((d[cr] > cfg['cranium_max_delta']).sum())} verts")
    if d.max() > cfg["max_delta"]:
        issues.append(f"max delta {d.max()*1000:.1f} mm > {cfg['max_delta']*1000:.0f} mm")
    if len(E["fidx"]):
        bad = ~np.isin(B.region[E["fidx"]], OWNERS[role]["edit"])
        if bad.any():
            issues.append(f"{int(bad.sum())} re-UV'd triangles outside {role} regions")
        if not np.isfinite(E["UV"]).all() or E["UV"].min() < 0 or E["UV"].max() > 1:
            issues.append("edit UVs outside 0..1 / non-finite")
    return {"ok": not issues, "issues": issues, "moved": int((d > 1e-7).sum()), "max_mm": round(float(d.max() * 1000), 2)}


def check_part(dirpath):
    role = os.path.basename(os.path.normpath(dirpath))
    if role not in OWNERS:
        raise SystemExit(f"{dirpath}: folder name must be a role {ROLES}")
    D = Donor()
    rep = {"role": role, "parts": {}, "issues": []}
    tris = 0
    for name in list_parts(dirpath):
        p = load_part(dirpath, name)
        m, iss = p["meta"], []
        if m.get("donor_sha") != DONOR_SHA:
            iss.append("donor_sha mismatch")
        if m.get("mesh") != OWNERS[role]["mesh"] and not (role == "hair" and m.get("mesh") == "body"):
            iss.append(f"mesh {m.get('mesh')} not {OWNERS[role]['mesh']}")
        bad = set(m.get("replaces", [])) - set(OWNERS[role]["replace"])
        if bad:
            iss.append(f"replaces regions it does not own: {sorted(bad)}")
        unk = set(p["bones"]) - set(D.bones)
        if unk:
            iss.append(f"unknown bones {sorted(unk)}")
        for k in ("P", "UV", "N", "W"):
            if not np.isfinite(p[k]).all():
                iss.append(f"non-finite {k}")
        if p["UV"].size and (p["UV"].min() < -1e-4 or p["UV"].max() > 1 + 1e-4):
            iss.append("UVs outside the tile 0..1")
        if p["meta"]["tile"] not in CONFIG["tiles"] and p["meta"]["tile"] not in ("donor_body", "donor_groom"):
            iss.append(f"unknown tile {p['meta']['tile']}")
        ws = p["W"].sum(1)
        if (ws < 0.99).any() or (ws > 1.01).any():
            iss.append(f"{int(((ws < .99) | (ws > 1.01)).sum())} vertices with weight sum != 1")
        if role == "hair":
            used = [b for j, b in enumerate(p["bones"]) if p["W"][:, j].max() > 1e-4]
            arm = [b for b in used if b.startswith(NOT_FOR_HAIR)]
            if arm:
                iss.append(f"hair weighted to {arm} (braid-along-arm bug): head + hair_1..5 only")
        tile = p["meta"]["tile"]
        if tile in CONFIG["tiles"]:
            sheet, x0, y0, x1, y1 = CONFIG["tiles"][tile]
            for kk in ("albedo", "orm", "normal"):
                if not os.path.exists(os.path.join(dirpath, "tiles", f"{tile}_{kk}.png")):
                    iss.append(f"missing tiles/{tile}_{kk}.png ({x1-x0}x{y1-y0})")
        tris += len(p["F"])
        rep["parts"][name] = {"tris": int(len(p["F"])), "replaces": m.get("replaces", []), "issues": iss}
        rep["issues"] += [f"{name}: {x}" for x in iss]
    E = load_edits(dirpath)
    if E is not None:
        if role not in ("face", "body"):
            rep["issues"].append("only face/body may ship edits.npz")
        else:
            a = audit_edits(D, E, role)
            rep["edits"] = a
            rep["issues"] += [f"edits: {x}" for x in a["issues"]]
    rt = os.path.join(dirpath, "retarget.json")
    if os.path.exists(rt):
        if role != "body":
            rep["issues"].append("only the body role ships retarget.json")
        else:
            try:
                rep["retarget"] = retarget_report(D, load_retarget(rt))
            except ValueError as e:
                rep["issues"].append(str(e))
    # budget: role tris vs the donor regions it replaces
    rep["tris_new"] = tris
    cap = CONFIG["budget"].get({"face": "face", "hair": "groom", "body": "body"}[role])
    replaced = set(r for p in rep["parts"].values() for r in p["replaces"])
    kept = 0
    for mk, M in D.mesh.items():
        owned = [r for r in OWNERS[role]["edit"] + OWNERS[role]["replace"] if r in set(M.region)]
        kept += int(np.isin(M.region, [r for r in owned if r not in replaced]).sum())
    rep["role_tris"] = tris + kept
    if rep["role_tris"] > cap:
        rep["issues"].append(f"role tris {rep['role_tris']} > budget {cap}")
    rep["ok"] = not rep["issues"]
    print(json.dumps(rep, indent=1))
    return rep


# =============================================================================================== probe
def probe():
    D = Donor()
    s = D.summary()
    # demo retarget dry-run (the r24 lithe direction; the BODY role owns the real numbers)
    demo = {"bones": {"thigh_L": {"len": 1.04, "w": 0.90, "d": 0.92}, "thigh_R": {"len": 1.04, "w": 0.90, "d": 0.92},
                      "shin_L": {"len": 1.03, "w": 0.90, "d": 0.92}, "shin_R": {"len": 1.03, "w": 0.90, "d": 0.92},
                      "upperarm_L": {"w": 0.88, "d": 0.88}, "upperarm_R": {"w": 0.88, "d": 0.88},
                      "chest": {"w": 0.96}, "head": {"len": 1.05, "w": 1.05, "d": 1.05}}, "ground": True}
    s["retarget_identity"] = retarget_report(D, {"bones": {}})
    s["retarget_demo"] = {"spec": demo, "report": retarget_report(D, demo)}
    # export the embedded maps (webp) for previews / the texture artist
    js = D.json
    raw = open(D.path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    buf = raw[20 + n + 8:]
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        ext = {"image/webp": ".webp", "image/png": ".png"}.get(im.get("mimeType"), ".bin")
        p = os.path.join(DONOR_DIR, im["name"] + ext)
        with open(p, "wb") as f:
            f.write(buf[o:o + bv["byteLength"]])
    s["maps"] = sorted(fn for fn in os.listdir(DONOR_DIR) if fn.endswith((".webp", ".png")))
    s["materials"] = js["materials"]
    save_json(os.path.join(DONOR_DIR, "donor.json"), s)
    print(json.dumps({k: s[k] for k in ("sha256", "cranium_vertices", "maps")}, indent=1))
    for k, m in s["meshes"].items():
        print(k, m["tris"], {r: v["tris"] for r, v in m["regions"].items()})
    print("identity max move", s["retarget_identity"]["max_vertex_move_m"])
    print("demo", json.dumps(s["retarget_demo"]["report"])[:900])


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--probe"]:
        probe()
    elif a[:1] == ["--check-part"] and len(a) > 1:
        sys.exit(0 if check_part(a[1])["ok"] else 1)
    elif a[:1] == ["--retarget-report"] and len(a) > 1:
        print(json.dumps(retarget_report(Donor(), load_retarget(a[1])), indent=1))
    else:
        print(__doc__)
