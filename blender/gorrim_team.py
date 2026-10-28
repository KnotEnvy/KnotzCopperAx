"""Gorrim team (C2 r25): the shared DONOR + PARTS interface. Owner: the model LEAD.

Specialists import this module and never edit it. If you need a change, write it in your notes (docs/notes/hero-gorrim.md,
"## Team round (r25)") and the lead makes it. Pattern = Brann r19 (blender/brann_team.py): the shipped GLB is ONE joined
skinned mesh; specialists work in parallel on named REGIONS of it and hand back PARTS (new geometry that replaces whole
regions, or overlays that replace nothing) or EDITS (face role only: per-vertex moves / per-corner UV + normals on donor
triangles). blender/build_hero_gorrim_team.py assembles previews and the integrated release.

Pure helpers (GLB reader, frame conversion, boundary edges, Blender object/armature helpers) are imported from
brann_team (read-only reuse); everything Gorrim-specific (paths, SHA, regions, tiles, budgets, owners, audits) is here.

Frames: BLENDER frame everywhere (Z up, character faces -Y, his LEFT = +X), metres. UVs Blender convention (v up).

No-slot commands (Blender's bundled python, numpy only):
  PY=~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13
  $PY -I blender/gorrim_team.py --probe             -> donor/donor.json + donor/regions.npz (+ regions.png debug splat)
  $PY -I blender/gorrim_team.py --check-part progress/tmp/gorrim_team/parts/<role>
"""
import hashlib
import json
import os
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import brann_team as _bt  # noqa: E402  (pure helpers only: read_glb, to_blender, boundary_edges, bpy helpers)

ROOT = os.path.dirname(HERE)
TEAM = os.path.join(ROOT, "progress", "tmp", "gorrim_team")
DONOR_DIR = os.path.join(TEAM, "donor")
PARTS_DIR = os.path.join(TEAM, "parts")
DONOR_GLB = os.path.join(DONOR_DIR, "hero_gorrim.glb")
DONOR_SHA = "5a44850e358be63b44b7f643d587e53662f063c5e93bad7b38452073dc0a4ee7"   # shipped Sept 2026 (Wave B r4, board 6.8)
DONOR_ALBEDO_PNG = os.path.join(DONOR_DIR, "gorrim_albedo.png")   # Sept master (classification only); GLB embeds webp
REGIONS_NPZ = os.path.join(DONOR_DIR, "regions.npz")

read_glb, to_blender, boundary_edges, sha256 = _bt.read_glb, _bt.to_blender, _bt.boundary_edges, _bt.sha256

# build_hero_gorrim.build `los` join order, verified by --probe (connected components + dominant bones):
# body_lo (incl. head, helm, mantle, hauberk, belt, boots) | hand_lo_L | hand_lo_R | kilt_lo (mail skirt) | beard_lo
# (beard + moustache + 3 braids + brass rings + the 2 brow tufts = the 182/178-tri components above z 1.22).
PART_RANGES = [("body", 0, 14800), ("hand_L", 14800, 15950), ("hand_R", 15950, 17100), ("kilt", 17100, 19500),
               ("beard", 19500, 26900)]
HEAD_Z = 1.085            # build_hero_gorrim.HEAD_BOX z0
BROW_Z = 1.22             # beard-range triangles above this = brows
# Helm rim plane (tilted, ears kept bare): z_rim(y) linear between the front (y -0.10, z 1.285) and back (y +0.11, z 1.195).
RIM = ((-0.10, 1.285), (0.11, 1.195))

CONFIG = {
    # ---- triangle budget (blueprint docs/notes/blueprints/hero_gorrim.md §Budget). Hard cap 75k; PLAN 62k, team cap 68k.
    "budget": {"total_cap": 75000, "team_cap": 68000, "total_plan": 62000,
               "body_retained": 13600, "face_mesh": 6000, "face_extra": 1200, "beard": 14000, "brows": 800,
               "helm": 7000, "coif": 3000, "bracers": 2400, "jerkin": 5500,
               "hands": 5000, "belt": 1500, "boots": 3000, "tassets": 1500},
    "face_edit": {"max_delta": 0.020, "pinned_tol": 1e-6},
    # ---- sheets: three 2048 materials (decision D1 in the blueprint; fallback = gear tiles folded into the body sheet).
    # rim: kcaRimScale written to glTF extras (None = engine default). The texture artist owns the final values.
    # rims calibrated by the texture artist on stage 1 + select (r25 texture ckpt 10): body .3 / gear .3 / groom .1.
    "sheets": {"body": {"material": "M_hero_gorrim", "res": 2048, "rim": 0.3},
               "gear": {"material": "M_hero_gorrim_gear", "res": 2048, "rim": 0.3},
               "groom": {"material": "M_hero_gorrim_groom", "res": 2048, "rim": 0.1, "alpha": "MASK", "cutoff": 0.45}},
    # ---- tiles: name -> (sheet, x0, y0, x1, y1) px of a 2048 sheet, origin bottom-left (Blender UV). Author each tile at
    # exactly (x1-x0) x (y1-y0) px; part UVs are LOCAL to the tile (0..1). Texture artist may move a box, never shrink it
    # without its owner.
    "tiles": {
        "surface": ("body", 0, 0, 1424, 2048),        # retained donor charts, repacked translation-only (donor cover 45.5 %)
        "face":    ("body", 1456, 1456, 2032, 2032),  # 576 px face (+ lips/teeth/eyes) ~4x the Sept face density
        "hands":   ("body", 1456, 656, 2032, 1424),   # body role: new hands (576 x 768)
        "spare":   ("body", 1456, 16, 2032, 624),     # texture artist's reserve
        "helm":    ("gear", 0, 1024, 1024, 2048),     # armour: helm dome, bands, rivets, nose guard, horns, horn rings
        "armour":  ("gear", 1024, 1024, 2048, 2048),  # armour: coif + bracers + jerkin shoulder fur trim
        "jerkin":  ("gear", 0, 0, 1024, 1024),        # armour: leather jerkin front/back panels, straps, studs
        "lower":   ("gear", 1024, 0, 2048, 1024),     # body role: belt + knotwork buckle disc, boot wraps + fur tops, tassets
        "beard":   ("groom", 0, 0, 1408, 2048),       # face role: lock lanes / strand strips (stacking allowed)
        "brows":   ("groom", 1440, 1440, 2048, 2048), # face role: brow + moustache-tip strand strip (stacking allowed)
        "rings":   ("groom", 1440, 16, 2048, 1408),   # face role: brass knot rings (opaque, metal in ORM)
    },
    "cleanup": {"degenerate_area": 1e-10, "debris_max_tris": 12, "float_m": 0.003},
    "cover": {"max_gap_m": 0.004},    # helm replacement: every hole-rim vertex must be inside / within 4 mm of the new helm
}

# Region ownership. replace = regions a role's part may remove; edit = donor regions it may move (face only).
OWNERS = {
    "face":   {"edit": ["face", "head_other"], "replace": ["face", "beard", "brows"]},  # face: Tier B only (seam audit)
    "armour": {"edit": [], "replace": ["helm"]},                                          # helm: cover audit
    "body":   {"edit": [], "replace": ["hand_L", "hand_R"]},
}
PART_ROLES = {"face": ["face_mesh", "face_extra", "beard", "brows", "rings"],
              "armour": ["helm", "coif", "bracers", "jerkin"],
              "body": ["hands", "belt", "boots", "tassets"]}
TILE_OWNER = {"face": "face", "beard": "face", "brows": "face", "rings": "face", "helm": "armour", "armour": "armour",
              "jerkin": "armour", "hands": "body", "lower": "body", "spare": "texture", "surface": "texture"}


# =============================================================================================== donor (numpy)
def _png_rgb(path):
    """Minimal 8-bit RGB/RGBA PNG reader (no PIL in Blender's python). Slow paeth path is fine for a one-off probe."""
    d = open(path, "rb").read()
    i, idat = 8, b""
    while i < len(d):
        n, t = struct.unpack(">I4s", d[i:i + 8])
        c = d[i + 8:i + 8 + n]
        i += 12 + n
        if t == b"IHDR":
            w, h, _, ct = struct.unpack(">IIBB", c[:10])
        elif t == b"IDAT":
            idat += c
    ch = {6: 4, 2: 3}[ct]
    raw = zlib.decompress(idat)
    st = w * ch
    out = np.zeros((h, st), np.uint8)
    prev = np.zeros(st, np.int32)
    p = 0
    for y in range(h):
        f = raw[p]
        line = np.frombuffer(raw[p + 1:p + 1 + st], np.uint8).astype(np.int32)
        p += 1 + st
        if f == 0:
            cur = line
        elif f == 2:
            cur = (line + prev) & 255
        else:
            cur = np.zeros(st, np.int32)
            for x in range(st):
                a = cur[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                if f == 1:
                    pr = a
                elif f == 3:
                    pr = (a + b) // 2
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[x] = (line[x] + pr) & 255
        out[y] = cur
        prev = cur
    return out.reshape(h, w, ch)[..., :3]


class Donor:
    """Canonical donor arrays (Blender frame) + region label per triangle (frozen in donor/regions.npz)."""

    def __init__(self, path=DONOR_GLB, check_sha=True, classify=False):
        if check_sha and sha256(path) != DONOR_SHA:
            raise RuntimeError(f"donor {path} is not the Sept GLB ({DONOR_SHA[:12]}); snapshot it again")
        g = read_glb(path)
        self.path = path
        self.P, self.N, self.UVv = to_blender(g)
        self.F = g["F"]
        self.J, self.W = g["J"], g["W"]
        self.bones = g["bones"]
        self.Wn = np.zeros((len(self.P), len(self.bones)), np.float32)
        np.add.at(self.Wn, (np.repeat(np.arange(len(self.P)), 4), self.J.ravel()), self.W.ravel())
        self.Wn /= np.maximum(self.Wn.sum(1, keepdims=True), 1e-8)
        self.UV = self.UVv[self.F]
        self.NC = self.N[self.F]
        self.C = self.P[self.F].mean(1)
        self.pos_id = np.unique(np.round(self.P, 7), axis=0, return_inverse=True)[1].ravel()
        if classify or not os.path.exists(REGIONS_NPZ):
            self.region = self._classify()
        else:
            z = np.load(REGIONS_NPZ)
            if str(z["sha"]) != DONOR_SHA or len(z["region"]) != len(self.F):
                raise RuntimeError("regions.npz does not match the donor; rerun --probe")
            self.region = z["region"].astype(object)
        self.names = sorted(set(self.region))

    # ---------------------------------------------------------------- regions
    def _classify(self):
        m = len(self.F)
        if m != PART_RANGES[-1][2]:
            raise RuntimeError(f"donor has {m} tris, expected {PART_RANGES[-1][2]}")
        reg = np.empty(m, object)
        for name, a, b in PART_RANGES:
            reg[a:b] = name
        C = self.C
        bz = np.arange(PART_RANGES[4][1], m)
        reg[bz[C[bz, 2] > BROW_Z]] = "brows"
        body = np.arange(0, PART_RANGES[0][2])
        cb = C[body]
        headw = self.Wn[:, self.bones.index("head")][self.F[body]].mean(1)
        (y0, z0), (y1, z1) = RIM
        zr = z0 + (cb[:, 1] - y0) * (z1 - z0) / (y1 - y0)
        inhead = (cb[:, 2] > HEAD_Z) & (headw > 0.5)
        # face = front of the head below the helm rim: the Sept face chart + the black "mouth slot" chart (one UV island
        # of 30 tris at z 1.13-1.17) + the cheeks/nose/chin skin that the beard does not cover.
        face = inhead & (cb[:, 1] < -0.04) & (cb[:, 2] > 1.10) & (cb[:, 2] < zr + 0.004) & (np.abs(cb[:, 0]) < 0.10)
        horn_tip = (cb[:, 2] > 1.30) & (np.abs(cb[:, 0]) > 0.10)          # horn tips carry little head weight
        helm = (inhead & ~face & ((cb[:, 2] > zr - 0.004) | (np.abs(cb[:, 0]) > 0.11) & (cb[:, 2] > 1.25))) | horn_tip
        reg[body[face]] = "face"
        reg[body[helm]] = "helm"
        reg[body[inhead & ~face & ~helm]] = "head_other"
        # fur mantle (dark brown fur islands over the shoulders/back): by albedo, for the texture artist + armour fit
        if os.path.exists(DONOR_ALBEDO_PNG):
            img = _png_rgb(DONOR_ALBEDO_PNG).astype(np.float32)
            U = self.UV[body].mean(1)
            px = np.clip((U[:, 0] * img.shape[1]).astype(int), 0, img.shape[1] - 1)
            py = np.clip(((1 - U[:, 1]) * img.shape[0]).astype(int), 0, img.shape[0] - 1)
            col = img[py, px]
            isl = self._uv_islands(self.F[body])
            for i in np.unique(isl):
                s = isl == i
                if s.sum() < 200 or reg[body[s][0]] != "body":
                    continue
                med = np.median(col[s], 0)
                if med.max() < 75 and med[0] - med[2] > 10 and cb[s, 2].min() > 0.75:
                    reg[body[s & (reg[body] == "body")]] = "mantle"
        return reg

    def _uv_islands(self, Fsub):
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
            Pp = self.P[self.F[f]]
            d, a3 = self.texel_density([r])
            out["regions"][r] = {"tris": int(len(f)),
                                 "x": [round(float(Pp[..., 0].min()), 4), round(float(Pp[..., 0].max()), 4)],
                                 "y": [round(float(Pp[..., 1].min()), 4), round(float(Pp[..., 1].max()), 4)],
                                 "z": [round(float(Pp[..., 2].min()), 4), round(float(Pp[..., 2].max()), 4)],
                                 "area_m2": round(a3, 5), "texel_px_per_m": round(d, 1)}
        out["height_m"] = round(float(self.P[:, 2].max()), 4)
        out["width_m"] = round(float(np.ptp(self.P[:, 0])), 4)
        return out

    def pinned_positions(self, free_regions):
        outside = np.flatnonzero(~np.isin(self.region, list(free_regions)))
        return np.unique(self.pos_id[self.F[outside]].ravel())


# =============================================================================================== part files
PART_FORMAT = "kca-part-v1"


def save_part(dirpath, name, *, P, F, UV, N, W, bones, tile, meta):
    """One PART. dirpath = progress/tmp/gorrim_team/parts/<role>/   (same format as brann_team.save_part)

    P (n,3) Blender-frame metres at the donor rest pose · F (m,3) outward winding · UV (m,3,2) LOCAL tile coords 0..1
    N (m,3,3) unit corner normals · W (n,k) weights over `bones` (donor bone names; integration keeps top-4)
    meta: {"role", "replaces": [regions] ([] for overlays), "notes", optional "alpha": True (groom MASK cards)}
    Tiles: <dirpath>/tiles/<tile>_albedo.png (sRGB, RGBA if alpha), _orm.png, _normal.png at the tile's px size.
    """
    os.makedirs(dirpath, exist_ok=True)
    P, F, UV, N, W = (np.asarray(x) for x in (P, F, UV, N, W))
    assert P.ndim == 2 and P.shape[1] == 3 and F.shape[1] == 3 and UV.shape == (len(F), 3, 2) and N.shape == (len(F), 3, 3)
    assert W.shape[0] == len(P) and W.shape[1] == len(bones)
    np.savez_compressed(os.path.join(dirpath, name + ".npz"), P=P.astype(np.float32), F=F.astype(np.int32),
                        UV=UV.astype(np.float32), N=N.astype(np.float32), W=W.astype(np.float32), bones=np.array(bones))
    meta = dict(meta, format=PART_FORMAT, name=name, tile=tile, tris=int(len(F)), verts=int(len(P)), donor_sha=DONOR_SHA)
    with open(os.path.join(dirpath, name + ".json"), "w") as f:
        json.dump(meta, f, indent=2)
    return meta


load_part = _bt.load_part


def save_edits(dirpath, *, vidx, P_new, fidx, UV, N, tile="face", meta=None):
    """Face role only (Tier A): move donor vertices of face/head_other; re-UV face triangles into the face tile."""
    os.makedirs(dirpath, exist_ok=True)
    np.savez_compressed(os.path.join(dirpath, "edits.npz"), vidx=np.asarray(vidx, np.int32),
                        P_new=np.asarray(P_new, np.float32), fidx=np.asarray(fidx, np.int32),
                        UV=np.asarray(UV, np.float32), N=np.asarray(N, np.float32))
    meta = dict(meta or {}, format=PART_FORMAT + "-edits", tile=tile, donor_sha=DONOR_SHA, moved=int(len(vidx)),
                reuv=int(len(fidx)))
    with open(os.path.join(dirpath, "edits.json"), "w") as f:
        json.dump(meta, f, indent=2)
    return meta


load_edits = _bt.load_edits


# =============================================================================================== audits (numpy)
def audit_edits(D, E):
    cfg = CONFIG["face_edit"]
    free = OWNERS["face"]["edit"]
    issues = []
    newP = D.P.copy()
    newP[E["vidx"]] = E["P_new"]
    d = np.linalg.norm(newP - D.P, axis=1)
    pinned = np.isin(D.pos_id, D.pinned_positions(free))
    if (d[pinned] > cfg["pinned_tol"]).any():
        issues.append(f"{int((d[pinned] > cfg['pinned_tol']).sum())} pinned (helm/beard/body) vertices moved")
    order = np.argsort(D.pos_id)
    k, P2 = D.pos_id[order], newP[order]
    same = k[1:] == k[:-1]
    if (same & (np.linalg.norm(P2[1:] - P2[:-1], axis=1) > 1e-6)).any():
        issues.append("seam cracks (split vertices moved differently)")
    if d.max() > cfg["max_delta"]:
        issues.append(f"max delta {d.max()*1000:.1f} mm > {cfg['max_delta']*1000:.0f} mm")
    if (~np.isin(D.region[E["fidx"]], free)).any():
        issues.append("re-UV triangles outside face/head_other")
    if len(E["fidx"]) and (E["UV"].min() < 0 or E["UV"].max() > 1):
        issues.append("face UVs outside the local tile 0..1")
    return {"ok": not issues, "issues": issues, "max_delta_mm": round(float(d.max()) * 1000, 2),
            "moved": int((d > 1e-7).sum())}


def audit_seam(D, replaced, part):
    """Tier-B face_mesh: the part's open boundary must close the hole left by `replaced` exactly (welded positions)."""
    return _seam(D, replaced, part)


def _seam(D, replaced, part):
    keep = np.flatnonzero(~np.isin(D.region, replaced))
    hole = D.faces(*replaced)
    allP = np.concatenate([D.P, part["P"]])
    bk, _ = boundary_edges(np.concatenate([D.F[keep], part["F"] + len(D.P)]), allP)
    bh, _ = boundary_edges(np.concatenate([D.F[keep], D.F[hole]]), allP)
    extra = len(bk) - len(bh)
    return {"ok": extra <= 0, "open_edges_after": int(len(bk)), "open_edges_donor": int(len(bh)),
            "new_open_edges": int(max(extra, 0))}


def _ray_parity(pts, P, F, d=np.array([0.0, 0.0, 1.0]), eps=1e-9):
    """Inside test by ray-crossing parity (Moller-Trumbore, vectorised over triangles)."""
    A, B, C = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    e1, e2 = B - A, C - A
    h = np.cross(d, e2)
    a = (e1 * h).sum(1)
    ok = np.abs(a) > eps
    f = np.where(ok, 1.0 / np.where(ok, a, 1), 0)
    out = np.zeros(len(pts), bool)
    for i, p in enumerate(pts):
        s = p - A
        u = f * (s * h).sum(1)
        q = np.cross(s, e1)
        v = f * (q @ d)
        t = f * (e2 * q).sum(1)
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > eps)
        out[i] = hit.sum() % 2 == 1
    return out


def _point_tri_dist(pts, P, F):
    """Approximate nearest distance point -> triangle set (vertices + centroids + edge midpoints; fine for <= 4 mm)."""
    S = np.concatenate([P[F].mean(1), P, (P[F[:, 0]] + P[F[:, 1]]) / 2, (P[F[:, 1]] + P[F[:, 2]]) / 2,
                        (P[F[:, 2]] + P[F[:, 0]]) / 2])
    return np.array([np.sqrt(((S - p) ** 2).sum(1).min()) for p in pts])


def audit_cover(D, replaced, part):
    """Helm replacement (no exact seam): the donor hole rim left by removing `replaced` must be hidden — every rim
    vertex inside the new helm's closed volume or within cover.max_gap_m of its surface (the rim tucks under the brim)."""
    keep = np.flatnonzero(~np.isin(D.region, replaced))
    bh, pid = boundary_edges(D.F[keep], D.P)
    bd, _ = boundary_edges(D.F, D.P)
    newb = set(map(tuple, bh)) - set(map(tuple, bd))
    ids = np.unique(np.array(sorted(newb)).ravel()) if newb else np.zeros(0, int)
    first = np.full(pid.max() + 1, -1)
    first[pid[::-1]] = np.arange(len(pid))[::-1]
    rim = D.P[first[ids]] if len(ids) else np.zeros((0, 3))
    P, F = np.asarray(part["P"], np.float64), np.asarray(part["F"])
    inside = _ray_parity(rim, P, F) if len(rim) else np.zeros(0, bool)
    dist = _point_tri_dist(rim[~inside], P, F) if (~inside).any() else np.zeros(0)
    bad = int((dist > CONFIG["cover"]["max_gap_m"]).sum())
    return {"ok": bad == 0, "rim_vertices": int(len(rim)), "inside": int(inside.sum()),
            "max_gap_mm": round(float(dist.max()) * 1000, 2) if len(dist) else 0.0, "uncovered": bad}


def check_part(dirpath):
    role = os.path.basename(os.path.normpath(dirpath))
    rep = {"dir": dirpath, "role": role, "parts": {}, "ok": True}
    D_bones = read_glb(DONOR_GLB)["bones"]
    for fn in sorted(os.listdir(dirpath)):
        if not fn.endswith(".npz") or fn == "edits.npz":
            continue
        name = fn[:-4]
        p = load_part(dirpath, name)
        m = p["meta"]
        iss = []
        if role in OWNERS and not set(m.get("replaces", [])) <= set(OWNERS[role]["replace"]):
            iss.append(f"replaces regions it does not own: {sorted(set(m.get('replaces', [])) - set(OWNERS[role]['replace']))}")
        if role in PART_ROLES and name not in PART_ROLES[role]:
            iss.append(f"part name not in PART_ROLES[{role}] {PART_ROLES[role]}")
        if not set(p["bones"]) <= set(D_bones):
            iss.append(f"unknown bones {sorted(set(p['bones']) - set(D_bones))}")
        if not np.isfinite(p["P"]).all() or not np.isfinite(p["W"]).all():
            iss.append("non-finite positions/weights")
        if (p["W"].sum(1) < 0.5).any():
            iss.append(f"{int((p['W'].sum(1) < .5).sum())} unweighted verts")
        if p["UV"].min() < 0 or p["UV"].max() > 1:
            iss.append("UV outside local tile")
        tile = m.get("tile")
        if tile not in CONFIG["tiles"]:
            iss.append(f"unknown tile {tile}")
        elif role in OWNERS and TILE_OWNER.get(tile) != role:
            iss.append(f"tile {tile} belongs to {TILE_OWNER.get(tile)}")
        if (np.abs(np.linalg.norm(p["N"], axis=2) - 1) > 1e-2).any():
            iss.append("non-unit corner normals")
        if p["P"][:, 2].min() < -1e-3:
            iss.append("geometry below the floor")
        cap = CONFIG["budget"].get(name)
        if cap and len(p["F"]) > cap:
            iss.append(f"{len(p['F'])} tris > budget {cap}")
        for k in ("albedo", "orm", "normal"):
            if tile in CONFIG["tiles"] and not os.path.exists(os.path.join(dirpath, "tiles", f"{tile}_{k}.png")):
                iss.append(f"missing tiles/{tile}_{k}.png")
        rep["parts"][name] = {"tris": int(len(p["F"])), "replaces": m.get("replaces", []), "issues": iss}
        rep["ok"] &= not iss
    return rep


def audit_role(dirpath):
    """check_part + the geometric audits that need the donor (edits / Tier-B seam / helm cover)."""
    r = check_part(dirpath)
    D = None
    e = load_edits(dirpath)
    if e is not None:
        D = D or Donor()
        r["edits"] = audit_edits(D, e)
        r["ok"] &= r["edits"]["ok"] and r["role"] == "face"
    for name, info in r["parts"].items():
        if "face" in info["replaces"]:
            D = D or Donor()
            r["seam_face"] = audit_seam(D, ["face"], load_part(dirpath, name))
            r["ok"] &= r["seam_face"]["ok"]
        if "helm" in info["replaces"]:
            D = D or Donor()
            r["cover_helm"] = audit_cover(D, ["helm"], load_part(dirpath, name))
            r["ok"] &= r["cover_helm"]["ok"]
    return r


# =============================================================================================== Blender helpers
import_armature = _bt.import_armature            # call with glb=DONOR_GLB (deletes donor meshes, purges orphans)
object_from_arrays = _bt.object_from_arrays
transfer_weights = _bt.transfer_weights          # works on any Donor (uses D.F/D.P/D.Wn/D.region/D.bones only)
donor_surface = _bt.donor_surface                # ditto
save_json = _bt.save_json


def tile_to_sheet_uv(UV, tile):
    sheet, x0, y0, x1, y1 = CONFIG["tiles"][tile]
    res = CONFIG["sheets"][sheet]["res"]
    UV = np.asarray(UV, np.float32)
    return np.stack([(x0 + UV[..., 0] * (x1 - x0)) / res, (y0 + UV[..., 1] * (y1 - y0)) / res], -1)


def write_status(role, it, glb, qa, what_changed, self_check):
    """Builder -> QA critic loop file: progress/tmp/gorrim_team/<role>/status.json"""
    import datetime
    save_json(os.path.join(TEAM, role, "status.json"),
              {"role": role, "iter": it, "glb": glb, "qa": qa, "ready_for_review": True, "what_changed": what_changed,
               "self_check": self_check, "ts": datetime.datetime.now().isoformat(timespec="seconds")})


def _debug_png(D, path):
    pal = {"body": (90, 90, 90), "face": (240, 150, 120), "helm": (80, 140, 255), "head_other": (255, 230, 0),
           "beard": (255, 60, 0), "brows": (0, 255, 0), "hand_L": (0, 200, 200), "hand_R": (0, 200, 200),
           "kilt": (160, 0, 200), "mantle": (140, 90, 40)}
    C, res = D.C, 600
    tiles = []
    for (ax, dax, flip, z0, z1, w) in ((0, 1, 1, 1.0, 1.45, 0.25), (1, 0, -1, 1.0, 1.45, 0.25), (0, 1, 1, 0.0, 1.45, 0.75)):
        im = np.full((res, res, 3), 30, np.uint8)
        x = (C[:, ax] + w) / (2 * w) * res
        y = (z1 - C[:, 2]) / (z1 - z0) * res
        for i in np.argsort(-C[:, dax] * flip):
            if 0 <= x[i] < res - 2 and 0 <= y[i] < res - 2:
                im[int(y[i]):int(y[i]) + 3, int(x[i]):int(x[i]) + 3] = pal.get(D.region[i], (255, 255, 255))
        tiles.append(im)
    a = np.concatenate(tiles, 1)
    h, w_, _ = a.shape
    raw = b"".join(b"\x00" + a[r].tobytes() for r in range(h))

    def ch(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w_, h, 8, 2, 0, 0, 0)) +
                           ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))


# =============================================================================================== CLI (no Blender)
if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if "--probe" in argv:
        D = Donor(classify=True)
        np.savez_compressed(REGIONS_NPZ, region=D.region.astype(str), sha=np.array(DONOR_SHA))
        s = D.summary()
        s["face_vs_body_density"] = round(D.texel_density(["face"])[0] / D.texel_density(["body"])[0], 3)
        save_json(os.path.join(DONOR_DIR, "donor.json"), s)
        _debug_png(D, os.path.join(DONOR_DIR, "regions.png"))
        print(json.dumps({k: v for k, v in s.items() if k != "bones"}, indent=1))
    elif "--check-part" in argv:
        r = audit_role(argv[argv.index("--check-part") + 1])
        print(json.dumps(r, indent=1))
        sys.exit(0 if r["ok"] else 1)
    else:
        print(__doc__)
