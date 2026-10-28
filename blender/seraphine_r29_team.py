"""Seraphine r29 "Amazon" rebuild: the shared PARTS interface (numpy, no Blender slot).

Owner: the model LEAD. Specialists import this module and never edit it (write a workaround in YOUR module + a note).

What changed vs the r24 interface (blender/seraphine_team.py): there is NO donor mesh any more. The r28 GLB
(progress/tmp/seraphine_r29/backup/hero_seraphine.r28.57ddef4e4712.glb) only supplies the ARMATURE (42 joints, A-pose,
sockets, rolls), the material contract (names, extras) and a fallback head. Every visible triangle of r29 is a PART
shipped by a role; the integration (build_hero_seraphine_r29.py) assembles parts, binds them to the armature, packs the
two 2048 sheets (texture role), exports ONE GLB, validates, promotes.

Frames: BLENDER frame (Z up, she faces -Y, her LEFT = +X), metres, FINAL rest pose (the body role's retarget.json moves
the r28 joints; every part is authored against the moved joints = `Rig().joints`). UVs: Blender convention (v up),
LOCAL to the part's tile (0..1); the integration maps them into the sheet (CONFIG["tiles"]).

Roles and what they ship (progress/tmp/seraphine_r29/parts/<role>/):
  body    body.npz/.json (ONE watertight skin mesh: head + neck + torso + limbs + hands + feet soles), eyes_L/R (+ optional
          teeth), retarget.json (joint moves; bones/rolls/hierarchy unchanged), tiles/skin_{albedo,orm,normal}.png,
          body_ckpt.json (checkpoint number + the sha256 of body.npz: armour/hair/anim key off it).
  armour  top, brief, belt, loincloth_F/B, pauldron (+strap), bracer_L/R, boot_L/R (+fur), any strap; tiles/gear_*.png.
  hair    under_volume (shell), locks (big masses), fringe (alpha cards), braid, cuffs, circlet + sun_disc (metal);
          tiles/groom_*.png (RGBA albedo).  Weights: head + hair_1..5 ONLY (braid-along-arm bug).
  anim    weights_body.npz (final body weights, vertex-indexed on the FROZEN body.npz; optional), springs/clip edits in src/.
  texture blender/seraphine_r29_texture.py: pack_sheets(groups, objs, arm, fast, release) (see the build script).

CLI (Blender's bundled python or the scratch venv; no slot):
  PY=~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 (numpy only) or ~/kca-assets/venv/bin/python (numpy+scipy+PIL)
  $PY -I blender/seraphine_r29_team.py --probe                      -> progress/tmp/seraphine_r29/rig/rig.json (+ r28 maps)
  $PY -I blender/seraphine_r29_team.py --check-part parts/<role>    (format, owned names, budget, bones, weights, tiles)
  $PY -I blender/seraphine_r29_team.py --retarget-report <json>     (joint moves vs r28; heights; spans)
  $PY -I blender/seraphine_r29_team.py --budget                     (tris per role vs CONFIG, all parts folders)
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import seraphine_team as T0  # noqa: E402  (r24 interface: GLB parsing + retarget maths, imported read-only)

TEAM_R29 = os.path.join(ROOT, "progress", "tmp", "seraphine_r29")
# r30 fix round (opt-in): KCA_SERAPHINE_TEAM=<dir> reads/writes parts/ + frozen/ under <dir> (the release owner's assembled
# team folder). Unset = the r29 folder exactly as before. The rig donor and rig cache always stay in the r29 folder.
TEAM = os.path.abspath(os.environ["KCA_SERAPHINE_TEAM"]) if os.environ.get("KCA_SERAPHINE_TEAM") else TEAM_R29
PARTS_DIR = os.path.join(TEAM, "parts")
RIG_DIR = os.path.join(TEAM_R29, "rig")
DONOR_GLB = os.path.join(TEAM_R29, "backup", "hero_seraphine.r28.57ddef4e4712.glb")
DONOR_SHA = "57ddef4e4712c85f7fd5b46f0401b7675c7f9f0eca896613ddc7afb7bf930d1f"   # r28 live GLB (RESUME.md)
PART_FORMAT = "kca-part-v1"
MESH_NAMES = {"body": "hero_seraphine_mesh", "groom": "hero_seraphine_hair"}

CONFIG = {
    # ---- triangle budget (blueprint docs/notes/blueprints/hero_seraphine_r29.md). Cap 75k; plan <= 70k.
    "budget": {"total_cap": 75000, "total_plan": 70000,
               "body": 31000,      # skin + head (>= 8k in the head) + eyes      (lead re-split 10:11: body 31k / armour 17k)
               "armour": 17000,    # top, brief, belt, loincloths, pauldron, bracers, boots (incl. the boot feet)
               "hair": 22000},     # under-volume + locks + fringe cards + braid + cuffs + circlet
    "height": {"target": 1.78, "tol": 0.03},        # validate-glb --height 1.78 --height-tol 0.03 (incl. hair)
    "retarget": {"min": 0.75, "max": 1.30},
    # ---- sheets + tiles: name -> (sheet, x0, y0, x1, y1) px on a 2048 sheet, origin bottom-left (Blender UV).
    # Roles author tile PNGs at exactly (x1-x0) x (y1-y0) px; part UVs are LOCAL to the tile (0..1).
    # The texture artist owns the final sheets (may regrade/repaint any tile) and may move a box, never shrink one.
    "sheets": {"body": {"material": "M_hero_seraphine", "res": 2048, "rim": 0.97, "alpha": None},
               "groom": {"material": "M_hero_seraphine_hair", "res": 2048, "rim": 0.025, "alpha": "MASK",
                         "cutoff": 0.4, "specular": 0.06,
                         "extras": {"kcaMetalTint": [0.8, 0.12, 0.12, 0.15], "kcaMetalEnv": 0.85}}},
    "tiles": {
        "skin":  ("body", 0, 0, 1280, 2048),        # body role: skin + head (face chart >= 3x the body density)
        "gear":  ("body", 1280, 0, 2048, 2048),     # armour role: scales, leather, cloth, bronze, fur
        "groom": ("groom", 0, 0, 2048, 2048),       # hair role: locks, fringe cards (alpha), braid, metal patch
    },
}

OWNERS = {
    "body":   {"mesh": "body", "tile": "skin", "parts": ["body", "eyes_L", "eyes_R", "eyes", "teeth"]},
    "armour": {"mesh": "body", "tile": "gear",
               "parts": ["top", "top_frame", "brief", "belt", "loincloth_F", "loincloth_B", "pauldron", "strap",
                         "bracer_L", "bracer_R", "boot_L", "boot_R", "fur_L", "fur_R", "medallion", "buckles"]},
    "hair":   {"mesh": "groom", "tile": "groom",
               "parts": ["under_volume", "locks", "locks_back", "fringe", "braid", "cuff_nape", "cuff_tip", "tuft",
                         "circlet", "sun_disc", "wisps"]},
}
ROLES = tuple(OWNERS)
HAIR_BONES = ["head", "hair_1", "hair_2", "hair_3", "hair_4", "hair_5"]
NOT_FOR_HAIR = ("clavicle", "upperarm", "forearm", "hand", "chest", "spine", "neck", "thigh", "shin", "foot", "toe")
ARMOUR_ALLOW = {   # bone allow-lists per armour part (weights come from the body surface, then restricted)
    "top": ("chest", "spine", "clavicle_L", "clavicle_R"), "top_frame": ("chest", "clavicle_L", "clavicle_R", "spine"),
    "medallion": ("chest",), "brief": ("hips", "thigh_L", "thigh_R", "spine"), "belt": ("hips", "spine"),
    "loincloth_F": ("hips", "kilt_F_1", "kilt_F_2", "kilt_F_3"), "loincloth_B": ("hips", "kilt_B_1", "kilt_B_2", "kilt_B_3"),
    "pauldron": ("clavicle_R", "upperarm_R", "chest"), "strap": ("chest", "clavicle_R", "clavicle_L", "spine"),
    "bracer_L": ("forearm_L", "hand_L"), "bracer_R": ("forearm_R", "hand_R"),
    "boot_L": ("shin_L", "foot_L", "toe_L", "thigh_L"), "boot_R": ("shin_R", "foot_R", "toe_R", "thigh_R"),
    "fur_L": ("shin_L", "thigh_L"), "fur_R": ("shin_R", "thigh_R"), "buckles": None,
}


# =============================================================================================== rig (from r28)
class Rig:
    """Armature contract from the r28 GLB: bones (skin joint order), parent, rest joint heads (Blender frame),
    materials. `retarget` (body role's retarget.json) moves the joints; `self.joints` are the MOVED joints that every
    part is authored against. `self.joints0` = r28."""

    def __init__(self, path=DONOR_GLB, check_sha=True, retarget="auto"):
        if check_sha and T0.sha256(path) != DONOR_SHA:
            raise RuntimeError(f"{path} is not the r28 GLB ({DONOR_SHA[:12]}); re-copy public/ from commit 0862c232")
        js, buf = T0._parse(path)
        self.path, self.json, self._buf = path, js, buf
        skin = js["skins"][0]
        self.bones = [js["nodes"][j]["name"] for j in skin["joints"]]
        world, parent = T0._node_world(js)
        nid = {js["nodes"][j]["name"]: j for j in skin["joints"]}
        self.joints0 = {b: T0.g2b(world[nid[b]][:3, 3]) for b in self.bones}
        self.parent = {}
        for b in self.bones:
            p = parent.get(nid[b])
            self.parent[b] = js["nodes"][p]["name"] if p is not None and js["nodes"][p]["name"] in nid else None
        self.materials = {m["name"]: m for m in js["materials"]}
        self.spec = load_retarget() if retarget == "auto" else (retarget if isinstance(retarget, dict) else None)
        self.maps, self.dz = None, 0.0
        self.joints = dict(self.joints0)
        if self.spec:
            self.maps = T0.retarget_maps(self, self.spec)      # uses .bones .joints .parent (the r28 joints)
            self.joints = {b: self.maps[b]["new"] + ([0, 0, 0] if self.parent[b] is None else [0, 0, self.dz])
                           for b in self.bones}

    def donor_mesh(self, key):
        """The r28 meshes (fallback head / smoke test only): P, F, UV (corner), N (corner), Wn dense, dominant bone."""
        name = MESH_NAMES[key]
        i = next(i for i, m in enumerate(self.json["meshes"]) if m["name"] == name)
        M = T0.Mesh(self.json, self._buf, i, self.bones)
        return dict(P=M.P, F=M.F, UV=M.UV, N=M.NC, Wn=M.Wn, dom=M.tri_bone(), material=M.material)

    def summary(self):
        return {"glb": os.path.relpath(self.path, ROOT), "sha256": DONOR_SHA, "bones": self.bones, "parent": self.parent,
                "joints_r28": {b: [round(float(x), 4) for x in p] for b, p in self.joints0.items()},
                "joints_final": {b: [round(float(x), 4) for x in p] for b, p in self.joints.items()},
                "retarget": self.spec, "materials": self.json["materials"]}


def load_retarget(path=None):
    """parts/body/retarget.json: {"bones": {"<bone>": {"len": s, "w": s, "d": s}}, "notes": ".."} relative to r28
    (same semantics as r24: len along the bone toward its children, w/d across; limits 0.75-1.30; no rotations).
    `w`/`d` only matter for the r28 fallback meshes and the smoke test: r29 parts are authored in the final frame."""
    path = path or os.path.join(PARTS_DIR, "body", "retarget.json")
    if not os.path.exists(path):
        return None
    return json.load(open(path))


def retarget_report(spec):
    r0 = Rig(retarget=None)
    r1 = Rig(retarget=spec or {"bones": {}})
    j0, j1 = r0.joints0, r1.joints
    return {"joints_moved_mm": {b: round(float(np.linalg.norm(j1[b] - j0[b]) * 1000), 1) for b in r0.bones
                                if np.linalg.norm(j1[b] - j0[b]) > 5e-4},
            "hip_z": [round(float(j0["hips"][2]), 4), round(float(j1["hips"][2]), 4)],
            "leg_hip_to_ankle": [round(float(j0["thigh_L"][2] - j0["foot_L"][2]), 4), round(float(j1["thigh_L"][2] - j1["foot_L"][2]), 4)],
            "knee_z": [round(float(j0["shin_L"][2]), 4), round(float(j1["shin_L"][2]), 4)],
            "shoulder_span": [round(float(j0["upperarm_L"][0] - j0["upperarm_R"][0]), 4), round(float(j1["upperarm_L"][0] - j1["upperarm_R"][0]), 4)],
            "head_z": [round(float(j0["head"][2]), 4), round(float(j1["head"][2]), 4)],
            "neck_len": [round(float(j0["head"][2] - j0["neck"][2]), 4), round(float(j1["head"][2] - j1["neck"][2]), 4)],
            "foot_z": [round(float(j0["foot_L"][2]), 4), round(float(j1["foot_L"][2]), 4)],
            "socket_hand_R": [[round(float(x), 4) for x in j0["socket_hand_R"]], [round(float(x), 4) for x in j1["socket_hand_R"]]]}


# =============================================================================================== part files
def save_part(dirpath, name, *, P, F, UV, N, W, bones, tile, meta):
    """One PART = geometry in the FINAL rest frame. dirpath = progress/tmp/seraphine_r29/parts/<role>/
    P (n,3) Blender metres · F (m,3) outward winding · UV (m,3,2) LOCAL tile coords 0..1 · N (m,3,3) unit corner
    normals · W (n,k) weights over `bones` (donor names; top-4 kept, normalised at integration).
    meta: {"role", "mesh": "body"|"groom", "notes", optional "alpha": True (MASK cards, groom sheet only),
           optional "replaces": [names] (a part that supersedes another role's part by agreement, e.g. anim weights)}.
    Tiles: <dirpath>/tiles/<tile>_albedo.png (sRGB; RGBA on groom), _orm.png, _normal.png at the tile size."""
    os.makedirs(dirpath, exist_ok=True)
    P, F, UV, N, W = (np.asarray(x) for x in (P, F, UV, N, W))
    assert P.ndim == 2 and P.shape[1] == 3 and F.shape[1] == 3 and UV.shape == (len(F), 3, 2) and N.shape == (len(F), 3, 3)
    assert W.shape == (len(P), len(bones)), "W must be (verts, len(bones))"
    assert meta.get("mesh") in ("body", "groom"), "meta['mesh'] must be 'body' or 'groom'"
    np.savez_compressed(os.path.join(dirpath, name + ".npz"), P=P.astype(np.float32), F=F.astype(np.int32),
                        UV=UV.astype(np.float32), N=N.astype(np.float32), W=W.astype(np.float32), bones=np.array(bones))
    meta = dict(meta, format=PART_FORMAT, name=name, tile=tile, tris=int(len(F)), verts=int(len(P)), rig_sha=DONOR_SHA,
                frame="final-rest-r29")
    T0.save_json(os.path.join(dirpath, name + ".json"), meta)
    return meta


def load_part(dirpath, name):
    z = np.load(os.path.join(dirpath, name + ".npz"))
    meta = json.load(open(os.path.join(dirpath, name + ".json")))
    return dict(P=z["P"].astype(np.float64), F=z["F"], UV=z["UV"], N=z["N"], W=z["W"],
                bones=[str(b) for b in z["bones"]], meta=meta)


def list_parts(dirpath):
    if not os.path.isdir(dirpath):
        return []
    return sorted(fn[:-4] for fn in os.listdir(dirpath) if fn.endswith(".npz") and fn not in ("weights_body.npz",))


def part_sha(dirpath, name):
    return T0.sha256(os.path.join(dirpath, name + ".npz"))


def load_body(frozen=False):
    """The body role's skin mesh (+ its checkpoint meta). frozen=True reads progress/tmp/seraphine_r29/frozen/body/."""
    d = os.path.join(TEAM, "frozen", "body") if frozen else os.path.join(PARTS_DIR, "body")
    p = load_part(d, "body")
    ck = os.path.join(d, "body_ckpt.json")
    p["ckpt"] = json.load(open(ck)) if os.path.exists(ck) else None
    return p


# =============================================================================================== helpers for roles
def normals_smooth(P, F):
    """Area-weighted vertex normals -> per-corner (m,3,3)."""
    T3 = P[F]
    fn = np.cross(T3[:, 1] - T3[:, 0], T3[:, 2] - T3[:, 0])
    acc = np.zeros((len(P), 3))
    for k in range(3):
        np.add.at(acc, F[:, k], fn)
    acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    return acc[F]


def transfer_weights(P, body, allow=None, k=4, radius=None):
    """Weights for new geometry from the nearest body vertices (inverse-distance over k neighbours), restricted to an
    allow-list of bones (renormalised). body = load_body() dict (P, W, bones). Returns (W (n, len(body bones)), bones).
    Uses scipy's cKDTree when available (venv), else a chunked brute force (Blender python)."""
    BP, BW, bones = body["P"], body["W"], body["bones"]
    try:
        from scipy.spatial import cKDTree
        d, idx = cKDTree(BP).query(P, k=k)
    except ImportError:
        d = np.empty((len(P), k)); idx = np.empty((len(P), k), int)
        for a in range(0, len(P), 2048):
            D = np.linalg.norm(P[a:a + 2048, None] - BP[None], axis=2)
            ii = np.argsort(D, 1)[:, :k]
            idx[a:a + 2048] = ii; d[a:a + 2048] = np.take_along_axis(D, ii, 1)
    w = 1.0 / np.maximum(d, 1e-4)
    if radius is not None:
        w[d > radius] = 0
    w /= np.maximum(w.sum(1, keepdims=True), 1e-12)
    W = np.einsum("nk,nkb->nb", w, BW[idx])
    if allow is not None:
        keep = np.isin(bones, list(allow))
        W = W * keep[None]
    W = top_k(W, 4)
    return W, list(bones)


def top_k(W, k=4):
    W = np.asarray(W, np.float64).copy()
    if W.shape[1] > k:
        thr = -np.sort(-W, 1)[:, k - 1:k]
        W[W < thr] = 0
    s = W.sum(1, keepdims=True)
    bad = s[:, 0] < 1e-8
    W[bad] = 0
    W[bad, 0] = 1.0   # callers should check for this (unweighted vertex -> first bone)
    return W / np.maximum(W.sum(1, keepdims=True), 1e-12)


def surface_distance(P, Q, chunk=512):
    """Min point-to-point distance from each P to the cloud Q (coarse attach check; qa_model does the true BVH test)."""
    d = np.full(len(P), np.inf)
    for a in range(0, len(Q), chunk):
        d = np.minimum(d, np.linalg.norm(P[:, None] - Q[None, a:a + chunk], axis=2).min(1))
    return d


# =============================================================================================== audits
def check_part(dirpath):
    role = os.path.basename(os.path.normpath(dirpath))
    if role not in OWNERS:
        raise SystemExit(f"{dirpath}: folder name must be a role {ROLES}")
    R = Rig()
    own = OWNERS[role]
    rep = {"role": role, "parts": {}, "issues": [], "tris_role": 0}
    body = None
    if role != "body" and os.path.exists(os.path.join(PARTS_DIR, "body", "body.npz")):
        body = load_body()
    for name in list_parts(dirpath):
        p = load_part(dirpath, name)
        m, iss = p["meta"], []
        if m.get("rig_sha") != DONOR_SHA:
            iss.append("rig_sha mismatch (built against another armature)")
        if m.get("mesh") != own["mesh"] and not (role == "hair" and m.get("mesh") == "body"):
            iss.append(f"mesh {m.get('mesh')} not {own['mesh']}")
        base = name.split("__")[0]
        if base not in own["parts"]:
            iss.append(f"part name {name} not in {role}'s list {own['parts']} (use <name>__<variant> for variants)")
        unk = set(p["bones"]) - set(R.bones)
        if unk:
            iss.append(f"unknown bones {sorted(unk)}")
        for k in ("P", "UV", "N", "W"):
            if not np.isfinite(p[k]).all():
                iss.append(f"non-finite {k}")
        if p["UV"].size and (p["UV"].min() < -1e-4 or p["UV"].max() > 1 + 1e-4):
            iss.append("UVs outside the tile 0..1")
        if m.get("tile") != own["tile"]:
            iss.append(f"tile {m.get('tile')} is not {role}'s tile {own['tile']}")
        ws = p["W"].sum(1)
        if (np.abs(ws - 1) > 0.01).any():
            iss.append(f"{int((np.abs(ws - 1) > .01).sum())} vertices with weight sum != 1")
        nz = (p["W"] > 1e-4).sum(1)
        if (nz > 4).any():
            iss.append(f"{int((nz > 4).sum())} vertices with > 4 influences")
        used = [b for j, b in enumerate(p["bones"]) if p["W"][:, j].max() > 1e-4]
        if role == "hair":
            bad = [b for b in used if b.startswith(NOT_FOR_HAIR)]
            if bad:
                iss.append(f"hair weighted to {bad}: head + hair_1..5 only")
        if role == "armour" and ARMOUR_ALLOW.get(base):
            bad = [b for b in used if b not in ARMOUR_ALLOW[base]]
            if bad:
                iss.append(f"{name} weighted to {bad}; allow-list {ARMOUR_ALLOW[base]}")
        if any(b.startswith("socket_") for b in used):
            iss.append("weights on socket bones")
        # feet / height / attach (coarse)
        if role == "body" and base == "body":
            zmin, zmax = float(p["P"][:, 2].min()), float(p["P"][:, 2].max())
            if abs(zmin) > 0.003:
                iss.append(f"soles not on z=0 (min z {zmin*1000:.1f} mm)")
            rep["body_height_m"] = round(zmax, 4)
            if not (1.70 <= zmax <= 1.80):
                iss.append(f"body height {zmax:.3f} m outside 1.70-1.80 (hair adds ~2 cm; validate wants 1.78 +- .03)")
        if body is not None and base not in ("fringe", "wisps", "loincloth_F", "loincloth_B", "braid", "tuft"):
            d = surface_distance(p["P"][::max(1, len(p["P"]) // 400)], body["P"])
            rep["parts"].setdefault(name, {})["min_dist_to_body_mm"] = round(float(d.min() * 1000), 2)
            if d.min() > 0.003:
                iss.append(f"{name} floats >= 3 mm off the body (coarse point test)")
        tile = m.get("tile")
        if tile in CONFIG["tiles"]:
            sheet, x0, y0, x1, y1 = CONFIG["tiles"][tile]
            for kk in ("albedo", "orm", "normal"):
                if not os.path.exists(os.path.join(dirpath, "tiles", f"{tile}_{kk}.png")):
                    iss.append(f"missing tiles/{tile}_{kk}.png ({x1-x0}x{y1-y0})")
        rep["tris_role"] += int(len(p["F"]))
        rep["parts"].setdefault(name, {}).update({"tris": int(len(p["F"])), "verts": int(len(p["P"])), "bones_used": used,
                                                  "issues": iss})
        rep["issues"] += [f"{name}: {x}" for x in iss]
    if role == "body":
        rt = os.path.join(dirpath, "retarget.json")
        if os.path.exists(rt):
            try:
                rep["retarget"] = retarget_report(load_retarget(rt))
            except ValueError as e:
                rep["issues"].append(str(e))
        if "body" not in rep["parts"]:
            rep["issues"].append("body.npz missing (the skin mesh)")
    cap = CONFIG["budget"][role]
    if rep["tris_role"] > cap:
        rep["issues"].append(f"role tris {rep['tris_role']} > budget {cap}")
    rep["ok"] = not rep["issues"]
    print(json.dumps(rep, indent=1))
    return rep


def budget():
    out, tot = {}, 0
    for role in ROLES:
        d = os.path.join(PARTS_DIR, role)
        n = sum(int(json.load(open(os.path.join(d, nm + ".json")))["tris"]) for nm in list_parts(d))
        out[role] = {"tris": n, "budget": CONFIG["budget"][role]}
        tot += n
    out["total"] = {"tris": tot, "plan": CONFIG["budget"]["total_plan"], "cap": CONFIG["budget"]["total_cap"]}
    print(json.dumps(out, indent=1))
    return out


def probe():
    R = Rig(retarget=None)
    s = R.summary()
    os.makedirs(RIG_DIR, exist_ok=True)
    js, raw = R.json, open(R.path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    buf = raw[20 + n + 8:]
    for im in js.get("images", []):           # r28 maps: texture artist's reference for the old palette / scale rows
        bv = js["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        ext = {"image/webp": ".webp", "image/png": ".png"}.get(im.get("mimeType"), ".bin")
        with open(os.path.join(RIG_DIR, "r28_" + im["name"] + ext), "wb") as f:
            f.write(buf[o:o + bv["byteLength"]])
    for k in ("body", "groom"):
        m = R.donor_mesh(k)
        s[f"r28_{k}_tris"] = int(len(m["F"]))
    s["maps"] = sorted(fn for fn in os.listdir(RIG_DIR) if fn.endswith((".webp", ".png")))
    T0.save_json(os.path.join(RIG_DIR, "rig.json"), s)
    print(json.dumps({k: s[k] for k in ("sha256", "bones", "maps", "r28_body_tris", "r28_groom_tris")}, indent=1))
    print("joints:", {b: [round(float(x), 3) for x in p] for b, p in R.joints0.items() if b in
                      ("hips", "spine", "chest", "neck", "head", "upperarm_L", "forearm_L", "hand_L", "thigh_L", "shin_L", "foot_L")})


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--probe"]:
        probe()
    elif a[:1] == ["--check-part"] and len(a) > 1:
        sys.exit(0 if check_part(a[1])["ok"] else 1)
    elif a[:1] == ["--retarget-report"] and len(a) > 1:
        print(json.dumps(retarget_report(json.load(open(a[1]))), indent=1))
    elif a[:1] == ["--budget"]:
        budget()
    else:
        print(__doc__)
