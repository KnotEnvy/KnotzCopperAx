"""Seraphine team (C2 r24): preview + integration build over the shared interface (blender/seraphine_team.py).

Owner: the model LEAD. Does NOT replace build_hero_seraphine.py (the r18 builder stays the default rebuild path; its
default writes public/). This script writes public/ only with --promote, after the integration gates.

Written at planning time WITHOUT a Blender run (owner rule: plan phase = no Blender except the baseline QA). The numpy
half (seraphine_team.py) is tested on the donor. The FIRST user runs `--smoke` (donor round-trip, no parts) and
reports any bpy bug in the notes; fix it in a copy inside YOUR module if it blocks you and tell the lead.

Run only through tools/blender-run.mjs, e.g.
  NODE tools/blender-run.mjs --what "seraphine team preview hair 1" --owner seraphine-team-hair --mem-mb 5000 -- \
    -b --factory-startup -P blender/build_hero_seraphine_team.py -- --preview-role hair --out progress/tmp/seraphine_team/hair/preview/1

Modes
  --smoke                        donor only (round-trip check: tris, joints, materials; compare with the donor in QA)
  --preview-role face|hair|body  donor + THAT role's parts/edits (+ the body retarget if --retarget on). Local tiles get
                                 per-tile preview materials from the role's tile PNGs (no atlas pack needed).
  --retarget auto|on|off         apply parts/body/retarget.json (auto = on for body + integrate, off for face/hair
                                 previews; face/hair should ALSO preview once with `on` to see her new proportions)
  --integrate [--fast|--release] all roles -> seraphine_texture.pack_sheets (texture artist) -> one GLB. Without that
                                 module it exports preview materials (QA only, never a release).
  --skip-parts a,b               leave named parts out (per-part A/B)
  --promote                      copy the integrated release GLB to public/assets/models/hero_seraphine.glb (lead only)
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
from lib import meshutil, pipeline, skin  # noqa: E402
import seraphine_team as T  # noqa: E402

importlib.reload(T)
ARGS = {}


def log(msg):
    print(f"[seraphine-team] {msg}", flush=True)


# ------------------------------------------------------------------------------------------------ blender helpers
def import_armature():
    """Donor armature only (bone rolls/sockets as exported); meshes + orphan data removed so names stay clean."""
    meshutil.clear_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(T.DONOR_GLB))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    for o in list(bpy.context.scene.objects):
        if o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    return arm


def object_from_arrays(name, P, F, UV, N, Wn, bones, arm):
    ob = meshutil.mesh_from_numpy(name, np.asarray(P, np.float64), tris=np.asarray(F, np.int32))
    uv = ob.data.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", np.asarray(UV, np.float32).reshape(-1))
    ob.data.normals_split_custom_set(np.asarray(N, np.float32).reshape(-1, 3).tolist())
    Wk, _ = skin.top_k(np.asarray(Wn, np.float32).copy(), 4)
    Wk /= np.maximum(Wk.sum(1, keepdims=True), 1e-8)
    skin.write_groups(ob, list(bones), Wk)
    skin.bind(ob, arm)
    return ob


def load_images(paths, prefix):
    ims = {}
    for k, p in paths.items():
        im = bpy.data.images.load(os.path.abspath(p), check_existing=False)
        im.name = f"{prefix}_{k}"
        if k != "albedo":
            im.colorspace_settings.name = "Non-Color"
        ims[k] = im
    return ims


def donor_map_paths(sheet):
    pre = "seraphine_hair" if sheet == "groom" else "seraphine"
    return {k: os.path.join(T.DONOR_DIR, f"{pre}_{k}.webp") for k in ("albedo", "orm", "normal")}


def tile_map_paths(role, tile):
    d = os.path.join(T.PARTS_DIR, role, "tiles")
    out = {k: os.path.join(d, f"{tile}_{k}.png") for k in ("albedo", "orm", "normal")}
    for p in out.values():
        if not os.path.exists(p):
            raise FileNotFoundError(p)
    return out


def material_for(name, paths, alpha=False, cutoff=0.4):
    if alpha:
        import seraphine_hair_cards as cards   # proven r18 MASK card material (read-only import)
        return cards.card_material(name, paths["albedo"], paths["normal"], paths["orm"], cutoff=cutoff)
    ims = load_images(paths, name)
    return pipeline.final_material(name, ims["albedo"], ims["normal"], ims["orm"])


def patch_extras(path, per_material):
    """glTF material extras/extensions after export: kcaRimScale, MASK cutoff, KHR_materials_specular, and the
    donor's own extras (kcaMeta) for donor-named materials."""
    raw = open(path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    obj = json.loads(raw[20:20 + n])
    import re
    for m in obj.get("materials", []):
        nm = re.sub(r"\.\d{3}$", "", m.get("name") or "")
        spec = per_material.get(nm)
        if not spec:
            continue
        ex = m.setdefault("extras", {})
        ex.update(spec.get("extras", {}))
        if spec.get("rim") is not None:
            ex["kcaRimScale"] = float(spec["rim"])
        if spec.get("alpha") == "MASK":
            m["alphaMode"], m["alphaCutoff"], m["doubleSided"] = "MASK", float(spec.get("cutoff", 0.4)), True
        if spec.get("specular") is not None:
            m.setdefault("extensions", {})["KHR_materials_specular"] = {"specularFactor": float(spec["specular"])}
            if "KHR_materials_specular" not in obj.setdefault("extensionsUsed", []):
                obj["extensionsUsed"].append("KHR_materials_specular")
        if not ex:
            m.pop("extras")
    js = json.dumps(obj, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    tail = raw[20 + n:]
    out = struct.pack("<III", 0x46546C67, 2, 20 + len(js) + len(tail)) + struct.pack("<II", len(js), 0x4E4F534A) + js + tail
    open(path, "wb").write(out)


# ------------------------------------------------------------------------------------------------ inputs
def role_inputs(role):
    d = os.path.join(T.PARTS_DIR, role)
    skip = set(ARGS.get("skip_parts", ()))
    parts = [T.load_part(d, nm) for nm in T.list_parts(d) if nm not in skip]
    for p in parts:
        bad = set(p["meta"].get("replaces", [])) - set(T.OWNERS[role]["replace"])
        if bad:
            raise RuntimeError(f"{role}/{p['meta']['name']} replaces regions it does not own: {sorted(bad)}")
    edits = T.load_edits(d) if role in ("face", "body") else None
    if edits is not None:
        a = T.audit_edits(ARGS["D"], edits, role)
        if not a["ok"]:
            raise RuntimeError(f"{role} edits fail the audit: {a['issues']}")
    return parts, edits


def smooth_corner_normals(P, F, pos_id):
    """Area-weighted smooth normal per welded position, per corner (used only where edits moved vertices)."""
    T3 = P[F]
    fn = np.cross(T3[:, 1] - T3[:, 0], T3[:, 2] - T3[:, 0])
    acc = np.zeros((pos_id.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, pos_id[F[:, k]], fn)
    acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    return acc[pos_id[F]]


# ------------------------------------------------------------------------------------------------ assembly
def assemble(D, roles, retarget):
    """Groups keyed (mesh, tile, alpha, role) -> arrays in DONOR frame, then the retarget. Returns (groups, report)."""
    rep = {"roles": roles, "replaced": [], "edits": {}, "parts": {}, "tris": {}}
    drop, parts, edits = set(), [], {}
    for role in roles:
        ps, e = role_inputs(role)
        if e is not None:
            edits[role] = e
            rep["edits"][role] = e["meta"]
        for p in ps:
            drop |= set(p["meta"].get("replaces", []))
            parts.append((role, p))
            rep["parts"][f"{role}/{p['meta']['name']}"] = {"tris": int(len(p["F"])), "tile": p["meta"]["tile"],
                                                           "replaces": p["meta"].get("replaces", [])}
    rep["replaced"] = sorted(drop)
    groups = {}

    def add(key, P, F, UV, N, Wn):
        if len(F) == 0:                      # empty "drop" parts (eyes, skirt) only remove regions
            return
        g = groups.setdefault(key, {"P": [], "F": [], "UV": [], "N": [], "W": [], "n": 0})
        g["P"].append(P)
        g["F"].append(F + g["n"])
        g["UV"].append(UV)
        g["N"].append(N)
        g["W"].append(Wn)
        g["n"] += len(P)

    for mk in ("body", "groom"):
        M = D.mesh[mk]
        P = M.P.copy()
        UV, N = M.UV.copy(), M.NC.copy()
        tile_of = np.full(len(M.F), f"donor_{mk}", object)
        role_of = np.full(len(M.F), "donor", object)
        if mk == "body":
            moved = np.zeros(len(P), bool)
            for role, e in edits.items():
                P[e["vidx"]] = e["P_new"]
                moved[e["vidx"]] = True
            touch = moved[M.F].any(1)
            if touch.any():
                N[touch] = smooth_corner_normals(P, M.F, M.pos_id)[touch]
            for role, e in edits.items():
                if len(e["fidx"]):
                    UV[e["fidx"]], N[e["fidx"]] = e["UV"], e["N"]
                    tile_of[e["fidx"]] = e["meta"]["tile"]
                    role_of[e["fidx"]] = role
        keep = ~np.isin(M.region, list(drop))
        for key in sorted(set(zip(tile_of[keep], role_of[keep]))):
            sel = keep & (tile_of == key[0]) & (role_of == key[1])
            F = M.F[sel]
            used, inv = np.unique(F, return_inverse=True)
            add((mk, key[0], False, key[1]), P[used], inv.reshape(-1, 3), UV[sel], N[sel], M.Wn[used])
    for role, p in parts:
        Wn = T.dense_weights(p["W"], p["bones"], D.bones)
        add((p["meta"]["mesh"], p["meta"]["tile"], bool(p["meta"].get("alpha")), role), p["P"], p["F"], p["UV"],
            p["N"], Wn)
    for key, g in groups.items():
        for k in ("P", "F", "UV", "N", "W"):
            g[k] = np.concatenate(g[k])
    # ---- retarget (same map for every group and the armature)
    rep["retarget"] = None
    if retarget:
        maps = T.retarget_maps(D, retarget)
        dz = T.ground_offset(D, maps) if retarget.get("ground", True) else 0.0
        for g in groups.values():
            g["P"] = T.blend_points(g["P"], g["W"], D.bones, maps, dz)
            Wc = g["W"][g["F"]].reshape(-1, len(D.bones))
            g["N"] = T.blend_normals(g["N"].reshape(-1, 3), Wc, D.bones, maps).reshape(-1, 3, 3)
        rep["retarget"] = {"dz": dz, "bones": retarget.get("bones", {})}
        ARGS["maps"], ARGS["dz"] = maps, dz
    for key, g in groups.items():
        rep["tris"]["/".join(str(x) for x in key)] = int(len(g["F"]))
    rep["tris_total"] = int(sum(len(g["F"]) for g in groups.values()))
    return groups, rep


def retarget_armature(arm, D):
    maps, dz = ARGS.get("maps"), ARGS.get("dz", 0.0)
    if not maps:
        return {}
    meshutil.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    err = {}
    for b in arm.data.edit_bones:
        if b.name not in maps:
            continue
        m = maps[b.name]
        h = np.array(b.head[:])
        err[b.name] = float(np.linalg.norm(h - m["old"]))
        off = 0.0 if D.parent[b.name] is None else dz
        roll = b.roll
        nh = T.apply_map(m, h[None])[0] + [0, 0, off]
        nt = T.apply_map(m, np.array(b.tail[:])[None])[0] + [0, 0, off]
        b.head, b.tail, b.roll = nh, nt, roll
    bpy.ops.object.mode_set(mode="OBJECT")
    bad = {k: round(v * 1000, 2) for k, v in err.items() if v > 1e-3}
    if bad:
        log(f"WARN armature heads differ from donor joints by > 1 mm: {bad}")
    return {"max_head_mismatch_mm": round(max(err.values()) * 1000, 3) if err else 0}


def build_objects(groups, arm, D):
    """Preview materials: donor sheets keep donor maps; local tiles get tile PNG materials; UVs stay as given."""
    objs, extras, mats = [], {}, {}
    for key, g in sorted(groups.items(), key=lambda kv: str(kv[0])):
        mk, tile, alpha, role = key
        if len(g["F"]) == 0:
            continue
        if tile.startswith("donor_"):
            sheet = tile[len("donor_"):]
            name = T.CONFIG["sheets"][sheet]["material"]
            paths, a = donor_map_paths(sheet), sheet == "groom"
        else:
            sheet = T.CONFIG["tiles"][tile][0]
            name = f"M_sera_{role}_{tile}" + ("_alpha" if alpha else "")
            paths, a = tile_map_paths(role, tile), alpha or sheet == "groom"
        if name not in mats:
            mats[name] = material_for(name, paths, alpha=a, cutoff=T.CONFIG["sheets"]["groom"]["cutoff"])
            sh = T.CONFIG["sheets"][sheet]
            extras[name] = {"rim": sh.get("rim"), "alpha": "MASK" if a else None, "cutoff": sh.get("cutoff", 0.4),
                            "specular": sh.get("specular") if sheet == "groom" else None}
        obname = ("hero_seraphine_hair" if mk == "groom" else "hero_seraphine_mesh") + f"_{tile}_{role}"
        ob = object_from_arrays(obname, g["P"], g["F"], g["UV"], g["N"], g["W"], D.bones, arm)
        ob.data.materials.append(mats[name])
        objs.append(ob)
    donor_mat = {m["name"]: m for m in D.json["materials"]}
    for nm, m in donor_mat.items():          # keep the donor's extras (kcaMeta etc.) on donor-named materials
        if nm in extras:
            extras[nm]["extras"] = {k: v for k, v in m.get("extras", {}).items() if k != "kcaRimScale"}
            if "kcaRimScale" in m.get("extras", {}):
                extras[nm]["rim"] = m["extras"]["kcaRimScale"]
    return objs, extras


# ------------------------------------------------------------------------------------------------ main
def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--preview-role", choices=T.ROLES)
    ap.add_argument("--integrate", action="store_true")
    ap.add_argument("--roles", default=",".join(T.ROLES))
    ap.add_argument("--retarget", choices=("auto", "on", "off"), default="auto")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--promote", action="store_true")
    ap.add_argument("--skip-parts", default="")
    ap.add_argument("--no-pack", action="store_true", help="integrate with preview materials (cross-part QA before the pack)")
    return ap.parse_args(argv)


def main():
    a = parse()
    t0 = time.time()
    out = os.path.abspath(a.out)
    if out.startswith(os.path.join(T.ROOT, "public")):
        raise RuntimeError("--out must be scratch; use --promote after the gates")
    os.makedirs(out, exist_ok=True)
    D = T.Donor()
    ARGS.update(D=D, release=a.release, skip_parts=[x for x in a.skip_parts.split(",") if x])
    arm = import_armature()
    ARGS["arm"] = arm
    log(f"stage donor+armature done in {time.time()-t0:.1f}s")
    roles = [] if a.smoke else ([a.preview_role] if a.preview_role else [r for r in a.roles.split(",") if r])
    rt_on = a.retarget == "on" or (a.retarget == "auto" and ("body" in roles))
    spec = T.load_retarget() if rt_on else None
    groups, rep = assemble(D, roles, spec)
    rep["armature"] = retarget_armature(arm, D)
    log(f"stage assemble done in {time.time()-t0:.1f}s tris={rep['tris_total']} retarget={'on' if spec else 'off'}")
    objs, extras = build_objects(groups, arm, D)
    if a.integrate and a.no_pack:
        rep["pack"] = "preview-materials"
    elif a.integrate:
        try:
            import seraphine_texture        # texture artist's module (pack_sheets)
            importlib.reload(seraphine_texture)
            packed = seraphine_texture.pack_sheets(D, groups, objs, arm, fast=a.fast, release=a.release)
            objs, extras = packed["objects"], packed["materials"]
            rep["pack"] = packed["report"]
        except ImportError:
            log("WARN blender/seraphine_texture.py missing: exporting preview materials (QA only, not a release)")
            rep["pack"] = "preview-materials"
    path = os.path.join(out, "hero_seraphine.glb")
    pipeline.export_glb(path, [arm] + objs, scene_name="hero_seraphine")
    patch_extras(path, extras)
    rep.update(mode="smoke" if a.smoke else ("preview:" + a.preview_role if a.preview_role else "integrate"),
               glb=path, donor_sha=T.DONOR_SHA, skip_parts=ARGS["skip_parts"], seconds=round(time.time() - t0, 1))
    T.save_json(os.path.join(out, "seraphine_team_report.json"), rep)
    log(f"DONE {path} ({rep['tris_total']} tris, {rep['seconds']}s)")
    if a.promote:
        if not (a.integrate and a.release) or rep.get("pack") == "preview-materials":
            raise RuntimeError("--promote needs a packed --integrate --release build")
        dst = os.path.join(T.ROOT, "public", "assets", "models", "hero_seraphine.glb")
        bak = os.path.join(T.ROOT, "progress", "tmp", "seraphine_team", "promote_backup")
        os.makedirs(bak, exist_ok=True)
        if os.path.exists(dst):
            prev = T.sha256(dst)
            shutil.copy2(dst, os.path.join(bak, f"hero_seraphine.{prev[:12]}.glb"))
            log(f"backup of the live GLB ({prev}) -> {bak}")
        tmp = dst + ".tmp"
        shutil.copy2(path, tmp)
        os.replace(tmp, dst)
        log(f"promoted -> {dst} sha256 {T.sha256(dst)}")


if __name__ == "__main__":
    main()
