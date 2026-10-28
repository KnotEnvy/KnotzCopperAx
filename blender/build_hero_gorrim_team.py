"""Gorrim team (C2 r25): preview + integration build over the shared parts interface (blender/gorrim_team.py).
Forked from blender/build_hero_brann_team.py (r19); differences: three sheets (body/gear/groom), the helm cover audit,
the face role may replace face/beard/brows, donor maps are the shipped webp files.

Owner: the model LEAD. This does NOT replace build_hero_gorrim.py (the Sept builder stays the default rebuild path) and
never writes public/ unless --promote is given by the integration lead after the gates pass.

Run only through tools/blender-run.mjs, e.g.
  node tools/blender-run.mjs --what "gorrim team preview face" --owner gorrim-face --mem-mb 5000 -- \
    -b --factory-startup -P blender/build_hero_gorrim_team.py -- --preview-role face --out progress/tmp/gorrim_team/face/preview/1

Modes
  --preview-role face|armour|body donor + THAT role's parts/edits only (everything else = donor Sept). Each part tile
                                  gets its own preview material from its tile PNGs (so previews need no atlas pack).
                                  Multi-material GLBs are fine in the engine (Seraphine ships two materials).
  --integrate [--fast|--release]  all roles -> final sheets (body + gear + groom) -> one GLB.  The atlas pack and
                                  bake/transfer are the TEXTURE ARTIST's TODOs below; until they land, --integrate
                                  falls back to the per-tile preview materials (fine for QA, not for release).
  --roles face,armour,body         subset for --integrate (default all present in parts/)
  --promote                       copy the integrated GLB + sheets to public/ (integration lead only, after gates)
"""
import argparse
import importlib
import json
import os
import shutil
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
from lib import meshutil, pipeline  # noqa: E402
import gorrim_team as T  # noqa: E402

importlib.reload(T)
ROLES = ("face", "armour", "body")
ARGS = {}   # run context handed to the texture module (armature, release flag)


def log(msg):
    print(f"[gorrim-team] {msg}", flush=True)


# ------------------------------------------------------------------------------------------------ inputs
def role_inputs(role):
    d = os.path.join(T.PARTS_DIR, role)
    if not os.path.isdir(d):
        return [], None
    skip = set(ARGS.get("skip_parts", ()))
    parts = [T.load_part(d, fn[:-4]) for fn in sorted(os.listdir(d))
             if fn.endswith(".npz") and fn != "edits.npz" and fn[:-4] not in skip]
    edits = T.load_edits(d)
    for p in parts:
        bad = set(p["meta"].get("replaces", [])) - set(T.OWNERS[role]["replace"])
        if bad:
            raise RuntimeError(f"{role}/{p['meta']['name']} replaces regions it does not own: {sorted(bad)}")
    if edits is not None and role != "face":
        raise RuntimeError("only the face role may ship edits.npz")
    return parts, edits


def tile_images(role, tile):
    """Tile PNGs authored by the role (parts/<role>/tiles/<tile>_{albedo,orm,normal}.png)."""
    d = os.path.join(T.PARTS_DIR, role, "tiles")
    ims = {}
    for k in ("albedo", "orm", "normal"):
        p = os.path.join(d, f"{tile}_{k}.png")
        if not os.path.exists(p):
            raise FileNotFoundError(p)
        im = bpy.data.images.load(p, check_existing=False)
        im.name = f"gorrim_{tile}_{k}"
        if k != "albedo":
            im.colorspace_settings.name = "Non-Color"
        ims[k] = im
    return ims


def donor_images():
    ims = {}
    for k in ("albedo", "orm", "normal"):
        im = bpy.data.images.load(os.path.join(T.DONOR_DIR, f"gorrim_{k}.webp"), check_existing=False)
        im.name = f"gorrim_{k}"
        if k != "albedo":
            im.colorspace_settings.name = "Non-Color"
        ims[k] = im
    return ims


def material_for(name, ims, alpha=False, cutoff=0.45):
    if alpha:
        import seraphine_hair_cards as cards   # proven MASK card material (read-only import)
        return cards.card_material(name, ims["albedo"].filepath, ims["normal"].filepath, ims["orm"].filepath, cutoff=cutoff)
    mat = pipeline.final_material(name, ims["albedo"], ims["normal"], ims["orm"])
    for n in mat.node_tree.nodes:
        if n.type == "NORMAL_MAP":
            n.inputs["Strength"].default_value = 1.0       # Sept default; texture artist may tune per sheet
    return mat


def patch_extras(path, per_material):
    """Write glTF material extras (e.g. kcaRimScale) and MASK settings after export (exporter extras are off)."""
    raw = open(path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    obj = json.loads(raw[20:20 + n])
    import re
    for m in obj.get("materials", []):
        nm = m.get("name") or ""
        spec = per_material.get(nm) or per_material.get(re.sub(r"\.\d{3}$", "", nm))
        if not spec:
            continue
        if spec.get("rim") is not None:
            m.setdefault("extras", {})["kcaRimScale"] = float(spec["rim"])
        if spec.get("alpha") == "MASK":
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = float(spec.get("cutoff", 0.45))
            m["doubleSided"] = True
    js = json.dumps(obj, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    tail = raw[20 + n:]
    out = struct.pack("<III", 0x46546C67, 2, 20 + len(js) + len(tail)) + struct.pack("<II", len(js), 0x4E4F534A) + js + tail
    open(path, "wb").write(out)


# ------------------------------------------------------------------------------------------------ assembly
def assemble(D, arm, roles, preview_materials=True):
    """Donor minus replaced regions (+ face edits) + every part. Returns (objects, report, per_material extras)."""
    drop, edits, parts = [], None, []
    for role in roles:
        ps, e = role_inputs(role)
        if e is not None:
            a = T.audit_edits(D, e)
            if not a["ok"]:
                raise RuntimeError(f"face edits fail the audit: {a['issues']}")
            edits = e
        for p in ps:
            drop += p["meta"].get("replaces", [])
            parts.append((role, p))
    if "face" in drop:                      # Tier B: watertight seam required
        fp = [p for r, p in parts if "face" in p["meta"].get("replaces", [])]
        s = T.audit_seam(D, ["face"], fp[0])
        if not s["ok"]:
            raise RuntimeError(f"face Tier-B seam audit failed: {s}")
    if "helm" in drop:                      # helm replacement: the hole rim must hide under the new helm
        hp = [p for r, p in parts if "helm" in p["meta"].get("replaces", [])]
        c = T.audit_cover(D, ["helm"], hp[0])
        if not c["ok"]:
            raise RuntimeError(f"helm cover audit failed: {c}")
    S = T.donor_surface(D, drop, edits)
    S, crep = cleanup_surface(S)
    objs, extras, rep = [], {}, {"dropped": sorted(set(drop)), "parts": {}, "cleanup": crep}

    # donor surface: donor atlas triangles and (if edits) face-tile triangles go to separate objects/materials
    dimg = donor_images()
    dmat = material_for("M_hero_gorrim", dimg)
    extras["M_hero_gorrim"] = {"rim": T.CONFIG["sheets"]["body"]["rim"]}
    for tile in sorted(set(S["tile_of"])):
        sel = np.flatnonzero(S["tile_of"] == tile)
        used = np.unique(S["F"][sel])
        rm = np.full(len(S["P"]), -1, np.int64)
        rm[used] = np.arange(len(used))
        UV = S["UV"][sel] if tile == "donor" else T.tile_to_sheet_uv(S["UV"][sel], tile) if not preview_materials else S["UV"][sel]
        ob = T.object_from_arrays(f"donor_{tile}", S["P"][used], rm[S["F"][sel]], UV, S["N"][sel], S["W"][used], S["bones"], arm)
        if tile == "donor":
            ob.data.materials.append(dmat)
        else:
            mname = f"M_hero_gorrim_{tile}"
            ob.data.materials.append(material_for(mname, tile_images("face", tile)))
            extras[mname] = dict(extras["M_hero_gorrim"])    # face tile = body skin: same rim as the body in previews
        objs.append(ob)
        rep["parts"][ob.name] = int(len(sel))

    for role, p in parts:
        m = p["meta"]
        tile = m["tile"]
        sheet = T.CONFIG["tiles"][tile][0]
        alpha = bool(m.get("alpha"))
        k = clean_tris(p["P"], p["F"])
        crep[f"{role}_{m['name']}"] = {"input": int(len(p["F"])), "removed_degenerate_or_duplicate": int((~k).sum())}
        UV = p["UV"][k] if preview_materials else T.tile_to_sheet_uv(p["UV"][k], tile)
        ob = T.object_from_arrays(f"{role}_{m['name']}", p["P"], p["F"][k], UV, p["N"][k], p["W"], p["bones"], arm)
        mname = f"M_hero_gorrim_{tile}" if preview_materials else T.CONFIG["sheets"][sheet]["material"]
        if preview_materials and alpha:
            mname += "_mask"          # never share an opaque tile material with alpha cards (hair preview bug)
        mat = bpy.data.materials.get(mname) or material_for(mname, tile_images(role, tile), alpha=alpha,
                                                            cutoff=T.CONFIG["sheets"]["groom"]["cutoff"])
        ob.data.materials.append(mat)
        extras[mname] = {"rim": T.CONFIG["sheets"][sheet]["rim"],
                         "alpha": "MASK" if alpha else None, "cutoff": T.CONFIG["sheets"]["groom"]["cutoff"]}
        objs.append(ob)
        rep["parts"][ob.name] = int(k.sum())
    rep["tris_total"] = int(sum(rep["parts"].values()))
    return objs, rep, extras


# ------------------------------------------------------------------------------------------------ TEXTURE ARTIST TODOs
def pack_sheets(D, objs, fast):  # noqa: C901
    """TEXTURE ARTIST (integration phase): final 2048 sheets body / gear / groom (team_gorrim_texture.txt).

    1. Body sheet (M_hero_gorrim): repack retained donor charts TRANSLATION-ONLY into tile 'surface' (donor coverage
       45.5 %: dropped helm/face/beard/hand charts free room), transfer the donor bake (bilinear old->new + dilation, the
       proven code is brann_texture.py), paste 'face' + 'hands' (+ 'spare').
    2. Gear sheet (M_hero_gorrim_gear): paste 'helm', 'armour', 'jerkin', 'lower'.
    3. Groom sheet (M_hero_gorrim_groom, MASK): 'beard', 'brows', 'rings'; RGB dilated under alpha-0 texels.
    4. Rewrite UVs to sheet coords (T.tile_to_sheet_uv), join per material, one skin; corner normals/weights copied.
    Implementation lives in blender/gorrim_texture.py: pack_sheets(D, arm, objs, fast, release) ->
    {"objects": [...], "materials": {name: {"rim", "alpha", "cutoff"}}, "report": {...}}.
    """
    if not os.path.exists(os.path.join(HERE, "gorrim_texture.py")):
        raise NotImplementedError("pack_sheets: blender/gorrim_texture.py not written yet (team_gorrim_texture.txt)")
    import gorrim_texture
    importlib.reload(gorrim_texture)
    return gorrim_texture.pack_sheets(D, ARGS["arm"], objs, fast, ARGS["release"])


def clean_tris(P, F):
    """Keep-mask: drop zero-area and duplicate (same 3 vertices, any order) triangles."""
    P = np.asarray(P, np.float64)
    area = np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1) * .5
    keep = area >= T.CONFIG["cleanup"]["degenerate_area"]
    pid = np.unique(np.round(P, 7), axis=0, return_inverse=True)[1].ravel()
    _, first = np.unique(np.sort(pid[F], axis=1), axis=0, return_index=True)
    uniq = np.zeros(len(F), bool)
    uniq[first] = True
    return keep & uniq


def cleanup_surface(S):
    """Donor surface cleanup (Sept Gorrim baseline QA: 0 floating, 0 debris, 0 degenerate; kept as a safety net).

    Same rule as the skill test (brann_skilltest/scripts/brann_groom.retained_surface): connectivity over WELDED
    positions (glTF splits at UV/normal seams); a group of <= debris_max_tris triangles whose true surface distance to
    every substantive group is > float_m is removed. Positions, UVs, corner normals and weights of survivors are copied.
    """
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    cfg = T.CONFIG["cleanup"]
    P, F = S["P"], S["F"]
    valid = clean_tris(P, F)
    n_bad = int((~valid).sum())
    lab = np.unique(np.round(P, 7), axis=0, return_inverse=True)[1].ravel()
    par = np.arange(lab.max() + 1)

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for f in F[valid]:
        r = find(lab[f[0]])
        for v in f[1:]:
            par[find(lab[v])] = r
    groups = {}
    for fi in np.flatnonzero(valid):
        groups.setdefault(find(lab[F[fi, 0]]), []).append(fi)
    big = np.array([i for g in groups.values() if len(g) > cfg["debris_max_tris"] for i in g])
    V = [Vector(p) for p in P]
    bvh = BVHTree.FromPolygons(V, F[big].tolist(), all_triangles=True)
    removed = []
    for ids in groups.values():
        if len(ids) > cfg["debris_max_tris"]:
            continue
        own = BVHTree.FromPolygons(V, F[ids].tolist(), all_triangles=True)
        gap = 0.0 if own.overlap(bvh) else min(bvh.find_nearest(V[v])[3] for v in np.unique(F[ids]))
        if gap > cfg["float_m"]:
            valid[ids] = False
            removed.append({"tris": len(ids), "gap_m": round(gap, 5),
                            "z": round(float(P[np.unique(F[ids])][:, 2].mean()), 3)})
    used = np.unique(F[valid])
    rm = np.full(len(P), -1, np.int64)
    rm[used] = np.arange(len(used))
    out = dict(S, P=P[used], F=rm[F[valid]], UV=S["UV"][valid], N=S["N"][valid], W=S["W"][used],
               tile_of=S["tile_of"][valid], donor_faces=S["donor_faces"][valid])
    rep = {"donor_input": int(len(F)), "degenerate_or_duplicate": n_bad, "debris_groups_removed": len(removed),
           "debris_tris_removed": int(sum(r["tris"] for r in removed)), "retained": int(valid.sum()),
           "largest_removed": sorted(removed, key=lambda r: -r["tris"])[:5]}
    CLEANUP.update(rep)
    log(f"cleanup: {rep['degenerate_or_duplicate']} degenerate/dup, {rep['debris_groups_removed']} debris groups "
        f"({rep['debris_tris_removed']} tris) removed; {rep['retained']} donor tris kept")
    return out, rep


CLEANUP = {}


def cleanup(objs):
    """Integration cleanup report. The work happens on arrays in assemble() (cleanup_surface + clean_tris), before
    any Blender object exists, so survivors keep their exact donor attributes."""
    return dict(CLEANUP)


def restore_preview_donor(path):
    """Copy the donor's NORMAL/TANGENT/JOINTS_0/WEIGHTS_0 back onto retained donor corners after export (the Blender
    round-trip moves normals by ~4e-3 and prunes small weights; armour r25 ckpt 2). Only for exports whose donor
    triangles keep donor UVs (M_hero_gorrim primitives of previews / preview-material integrations). Corners are found
    by POSITION+UV (6 dp); joints remapped by name. Unmatched corners (face edits) are left alone and counted."""
    ct = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def read(p):
        raw = bytearray(open(p, "rb").read())
        n = struct.unpack_from("<I", raw, 12)[0]
        g = json.loads(raw[20:20 + n])

        def acc(i):
            a = g["accessors"][i]
            b = g["bufferViews"][a["bufferView"]]
            dt, c = ct[a["componentType"]], nc[a["type"]]
            st = b.get("byteStride", np.dtype(dt).itemsize * c)
            return np.ndarray((a["count"], c), dtype=dt, buffer=raw, offset=28 + n + b.get("byteOffset", 0) +
                              a.get("byteOffset", 0), strides=(st, np.dtype(dt).itemsize))
        return raw, g, acc
    _, dg, dacc = read(T.DONOR_GLB)
    raw, g, acc = read(path)
    da = dg["meshes"][0]["primitives"][0]["attributes"]
    oldb = [dg["nodes"][j]["name"] for j in dg["skins"][0]["joints"]]
    newb = [g["nodes"][j]["name"] for j in g["skins"][0]["joints"]]
    jmap = np.array([newb.index(b) for b in oldb])
    dN = dacc(da["NORMAL"])
    look = {}
    for i, k in enumerate(np.round(np.c_[dacc(da["POSITION"]), dacc(da["TEXCOORD_0"])], 6)):
        look.setdefault(tuple(k), []).append(i)
    done = miss = 0
    for me in g["meshes"]:
        for pr in me["primitives"]:
            if g["materials"][pr.get("material", 0)]["name"] != "M_hero_gorrim":
                continue
            at = pr["attributes"]
            oN = acc(at["NORMAL"])
            src, dst = [], []
            for i, k in enumerate(np.round(np.c_[acc(at["POSITION"]), acc(at["TEXCOORD_0"])], 6)):
                c = look.get(tuple(k))
                if not c:
                    miss += 1
                    continue
                src.append(min(c, key=lambda j: float(np.linalg.norm(dN[j] - oN[i]))))
                dst.append(i)
            src, dst = np.array(src, int), np.array(dst, int)
            for key in ("NORMAL", "TANGENT", "JOINTS_0", "WEIGHTS_0"):
                if key in at and key in da and len(src):
                    v = dacc(da[key])[src].copy()
                    if key == "JOINTS_0":
                        v = jmap[v.astype(np.int64)]
                    acc(at[key])[dst] = v
            done += len(dst)
    open(path, "wb").write(raw)
    return {"restored": done, "unmatched": miss, "method": "P+UV identity, named joints"}


# ------------------------------------------------------------------------------------------------ main
def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview-role", choices=ROLES)
    ap.add_argument("--integrate", action="store_true")
    ap.add_argument("--roles", default=",".join(ROLES))
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--promote", action="store_true")
    ap.add_argument("--no-pack", action="store_true", help="--integrate with per-tile preview materials (lead QA build)")
    ap.add_argument("--skip-parts", default="", help="comma list of part names to leave out (per-part A/B, e.g. jerkin)")
    return ap.parse_args(argv)


def main():
    a = parse()
    t0 = time.time()
    out = os.path.abspath(a.out)
    if out.startswith(os.path.join(T.ROOT, "public")):
        raise RuntimeError("--out must be scratch; use --promote after the gates")
    os.makedirs(out, exist_ok=True)
    D = T.Donor()
    arm = T.import_armature(T.DONOR_GLB)
    ARGS.update(arm=arm, release=a.release, skip_parts=[x for x in a.skip_parts.split(",") if x])
    log(f"stage donor+armature done in {time.time()-t0:.1f}s")
    roles = [a.preview_role] if a.preview_role else [r for r in a.roles.split(",") if r]
    objs, rep, extras = assemble(D, arm, roles, preview_materials=True)
    log(f"stage assemble done in {time.time()-t0:.1f}s tris={rep['tris_total']}")
    if a.integrate:
        rep["cleanup"].update(cleanup(objs))
        try:
            if a.no_pack:
                raise NotImplementedError("--no-pack")
            packed = pack_sheets(D, objs, a.fast)
            objs, extras = packed["objects"], packed["materials"]
            rep["pack"] = packed["report"]
        except NotImplementedError as e:
            log(f"WARN {e}; exporting per-tile preview materials (QA only, not a release)")
            rep["pack"] = "preview-materials"
    path = os.path.join(out, "hero_gorrim.glb")
    pipeline.export_glb(path, [arm] + objs, scene_name="hero_gorrim")
    patch_extras(path, extras)
    tr = rep.get("pack", {}).get("donor_uv_transfer") if isinstance(rep.get("pack"), dict) else None
    if tr:   # texture artist's opt-in: exact donor NORMAL/TANGENT/JOINTS/WEIGHTS back after the Blender round-trip
        import gorrim_texture
        rep["restore_donor"] = gorrim_texture.restore_export_donor(path, tr)
        log(f"restore_export_donor: {rep['restore_donor']}")
    elif rep.get("pack") == "preview-materials" or not a.integrate:
        rep["restore_donor"] = restore_preview_donor(path)       # donor UVs unchanged in preview materials
        log(f"restore_preview_donor: {rep['restore_donor']}")
    if "body" in roles and "kilt" not in ARGS["skip_parts"]:
        import gorrim_body   # body role's kilt weight repair; MUST run after the donor restore (else old weights return)
        gorrim_body.CONFIG["out"] = out          # its weights/kilt.npz side-output goes to scratch, not frozen parts/
        rep["kilt_patch"] = gorrim_body.patch_export_kilt(path)
        log(f"patch_export_kilt: {rep['kilt_patch']}")
    rep.update(mode="preview:" + a.preview_role if a.preview_role else "integrate", roles=roles, glb=path,
               skip_parts=ARGS["skip_parts"],
               donor_sha=T.DONOR_SHA, seconds=round(time.time() - t0, 1))
    T.save_json(os.path.join(out, "gorrim_team_report.json"), rep)
    log(f"DONE {path} ({rep['tris_total']} tris, {rep['seconds']}s)")
    if a.promote:
        if not a.integrate or rep.get("pack") == "preview-materials":
            raise RuntimeError("--promote needs a packed --integrate --release build")
        dst = os.path.join(T.ROOT, "public", "assets", "models", "hero_gorrim.glb")
        shutil.copy2(path, dst)
        rep["promoted_sha256"] = T.sha256(dst)
        T.save_json(os.path.join(out, "gorrim_team_report.json"), rep)
        log(f"promoted GLB to public/assets/models/hero_gorrim.glb sha256 {rep['promoted_sha256']} (textures embedded)")


if __name__ == "__main__":
    main()
