"""Brann team pilot (C2 r19): preview + integration build over the shared parts interface (blender/brann_team.py).

Owner: the model LEAD. This does NOT replace build_hero_brann.py (the r18 builder stays the default rebuild path) and
never writes public/ unless --promote is given by the integration lead after the gates pass.

Run only through tools/blender-run.mjs, e.g.
  node tools/blender-run.mjs --what "brann team preview hair" --owner brann-team-hair --mem-mb 5000 -- \
    -b --factory-startup -P blender/build_hero_brann_team.py -- --preview-role hair --out progress/tmp/brann_team/hair/preview

Modes
  --preview-role face|hair|gear   donor + THAT role's parts/edits only (everything else = donor r18). Each part tile
                                  gets its own preview material from its tile PNGs (so previews need no atlas pack).
                                  Multi-material GLBs are fine in the engine (Seraphine ships two materials).
  --integrate [--fast|--release]  all roles -> final sheets (body atlas + groom sheet) -> one GLB.  The atlas pack and
                                  bake/transfer are the TEXTURE ARTIST's TODOs below; until they land, --integrate
                                  falls back to the per-tile preview materials (fine for QA, not for release).
  --roles face,hair,gear          subset for --integrate (default all present in parts/)
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
import brann_team as T  # noqa: E402

importlib.reload(T)
ROLES = ("face", "hair", "gear")
ARGS = {}   # run context handed to the texture module (armature, release flag)


def log(msg):
    print(f"[brann-team] {msg}", flush=True)


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
        im.name = f"brann_{tile}_{k}"
        if k != "albedo":
            im.colorspace_settings.name = "Non-Color"
        ims[k] = im
    return ims


def donor_images():
    ims = {}
    for k in ("albedo", "orm", "normal"):
        im = bpy.data.images.load(os.path.join(T.DONOR_DIR, f"brann_{k}.png"), check_existing=False)
        im.name = f"brann_{k}"
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
            n.inputs["Strength"].default_value = 0.68      # r18 value; texture artist may tune per sheet
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
    S = T.donor_surface(D, drop, edits)
    S, crep = cleanup_surface(S)
    objs, extras, rep = [], {}, {"dropped": sorted(set(drop)), "parts": {}, "cleanup": crep}

    # donor surface: donor atlas triangles and (if edits) face-tile triangles go to separate objects/materials
    dimg = donor_images()
    dmat = material_for("M_hero_brann", dimg)
    extras["M_hero_brann"] = {"rim": T.CONFIG["sheets"]["groom"]["rim"]}   # r18 ran .14 on the whole body; keep for A/B
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
            mname = f"M_hero_brann_{tile}"
            ob.data.materials.append(material_for(mname, tile_images("face", tile)))
            extras[mname] = dict(extras["M_hero_brann"])     # face tile = body skin: same rim as the body in previews
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
        mname = f"M_hero_brann_{tile}" if preview_materials else T.CONFIG["sheets"][sheet]["material"]
        if preview_materials and alpha:
            mname += "_mask"          # never share an opaque tile material with alpha cards (hair preview bug)
        mat = bpy.data.materials.get(mname) or material_for(mname, tile_images(role, tile), alpha=alpha,
                                                            cutoff=T.CONFIG["sheets"]["groom"]["cutoff"])
        ob.data.materials.append(mat)
        extras[mname] = {"rim": T.CONFIG["sheets"]["groom"]["rim"] if sheet == "groom" else None,
                         "alpha": "MASK" if alpha else None, "cutoff": T.CONFIG["sheets"]["groom"]["cutoff"]}
        objs.append(ob)
        rep["parts"][ob.name] = int(k.sum())
    rep["tris_total"] = int(sum(rep["parts"].values()))
    return objs, rep, extras


# ------------------------------------------------------------------------------------------------ TEXTURE ARTIST TODOs
def pack_sheets(D, objs, fast):  # noqa: C901
    """TODO(texture artist, integration phase): final 2048 body atlas + 2048 groom sheet.

    1. Body atlas: repack the retained donor surface charts TRANSLATION-ONLY into tile 'surface' (no resampling loss),
       transfer the donor bake into the new chart positions (brann_skilltest/scripts/brann_groom.repair_atlas_padding
       is the proven transfer: bilinear old->new + dilation), paste tiles 'face' and 'gear' into their boxes,
       dilate >= 12 px, chart insets >= 6 px (4 px @2048 padding rule in qa_model.py).
       The scalp chart (hidden under the mane) may be scaled down to 0.5x: it only needs to read dark through gaps.
    2. Groom sheet: paste 'mane', 'pelt', 'furtrim' tiles; RGBA albedo (alpha only on card fringes).
    3. Rewrite every object's UVs to sheet coords (T.tile_to_sheet_uv) and join per material:
       hero_brann_mesh (M_hero_brann) + hero_brann_groom (M_hero_brann_groom), one skin.
    4. ONE release: --release writes 2048 maps; --fast 1024. Report padding per sheet.
    Return {"materials": {...}, "objects": [...], "report": {...}}.
    The implementation lives in the texture artist's own module blender/brann_texture.py (pack_sheets(D, arm, objs, fast,
    release) with the same return shape); this function only delegates so the lead's file stays the lead's.
    """
    if not os.path.exists(os.path.join(HERE, "brann_texture.py")):
        raise NotImplementedError("pack_sheets: blender/brann_texture.py not written yet (team_brann_texture.txt)")
    import brann_texture   # real import errors surface as errors, not as "not written yet"
    importlib.reload(brann_texture)
    return brann_texture.pack_sheets(D, ARGS["arm"], objs, fast, ARGS["release"])


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
    """Donor surface cleanup (r18: 1 floating 10-tri belt part + 970 debris specks + 2 degenerate kilt tris).

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
    ap.add_argument("--skip-parts", default="", help="comma list of part names to leave out (per-part A/B, e.g. pelts)")
    return ap.parse_args(argv)


def main():
    a = parse()
    t0 = time.time()
    out = os.path.abspath(a.out)
    if out.startswith(os.path.join(T.ROOT, "public")):
        raise RuntimeError("--out must be scratch; use --promote after the gates")
    os.makedirs(out, exist_ok=True)
    D = T.Donor()
    arm = T.import_armature()
    ARGS.update(arm=arm, release=a.release, skip_parts=[x for x in a.skip_parts.split(",") if x])
    log(f"stage donor+armature done in {time.time()-t0:.1f}s")
    roles = [a.preview_role] if a.preview_role else [r for r in a.roles.split(",") if r]
    objs, rep, extras = assemble(D, arm, roles, preview_materials=True)
    log(f"stage assemble done in {time.time()-t0:.1f}s tris={rep['tris_total']}")
    if a.integrate:
        rep["cleanup"].update(cleanup(objs))
        try:
            packed = pack_sheets(D, objs, a.fast)
            objs, extras = packed["objects"], packed["materials"]
            rep["pack"] = packed["report"]
        except NotImplementedError as e:
            log(f"WARN {e}; exporting per-tile preview materials (QA only, not a release)")
            rep["pack"] = "preview-materials"
    path = os.path.join(out, "hero_brann.glb")
    pipeline.export_glb(path, [arm] + objs, scene_name="hero_brann")
    patch_extras(path, extras)
    tr = rep.get("pack", {}).get("donor_uv_transfer") if isinstance(rep.get("pack"), dict) else None
    if tr:   # texture artist's opt-in: exact donor NORMAL/TANGENT/JOINTS/WEIGHTS back after the Blender round-trip
        import brann_texture
        rep["restore_donor"] = brann_texture.restore_export_donor(path, tr)
        log(f"restore_export_donor: {rep['restore_donor']}")
    rep.update(mode="preview:" + a.preview_role if a.preview_role else "integrate", roles=roles, glb=path,
               skip_parts=ARGS["skip_parts"],
               donor_sha=T.DONOR_SHA, seconds=round(time.time() - t0, 1))
    T.save_json(os.path.join(out, "brann_team_report.json"), rep)
    log(f"DONE {path} ({rep['tris_total']} tris, {rep['seconds']}s)")
    if a.promote:
        if not a.integrate or rep.get("pack") == "preview-materials":
            raise RuntimeError("--promote needs a packed --integrate --release build")
        shutil.copy2(path, os.path.join(T.ROOT, "public", "assets", "models", "hero_brann.glb"))
        log("promoted GLB to public/assets/models/hero_brann.glb (textures are embedded)")


if __name__ == "__main__":
    main()
