"""Seraphine r29 "Amazon": preview + integration build over blender/seraphine_r29_team.py (parts only, no donor mesh).

Owner: the model LEAD. Never replaces build_hero_seraphine.py / build_hero_seraphine_team.py (the r18/r24 paths stay).
Writes public/ only with --promote after the gates. Written at planning time WITHOUT a Blender run (owner rule): the
FIRST builder runs `--smoke` (r28 armature + r28 meshes round-trip) and posts the result; a small bpy bug may be fixed
by that builder with a clear note in docs/notes/hero-seraphine.md "## Amazon rebuild (r29)".

Run only through tools/blender-run.mjs, e.g.
  NODE tools/blender-run.mjs --what "seraphine r29 preview body 1" --owner seraphine-r29-body --mem-mb 5000 -- \
    -b --factory-startup -P blender/build_hero_seraphine_r29.py -- --preview-role body --out progress/tmp/seraphine_r29/body/preview/1

Modes
  --smoke                         r28 armature + r28 body/groom meshes re-exported (bpy half check; compare with r28 in QA)
  --preview-role body|armour|hair THAT role's parts (+ the body part always, so armour/hair previews sit on the skin; use
                                  --no-body to see a role alone). Tile PNGs become preview materials (no pack).
  --integrate [--fast|--release]  all roles -> seraphine_r29_texture.pack_sheets (texture role) -> one GLB. Without that
                                  module: preview materials (QA only, never a release).
  --roles a,b  --skip-parts x,y   subsets (per-part A/B).  --weights anim  use parts/anim/weights_body.npz on the body.
  --promote                       copy the integrated release GLB to public/assets/models/hero_seraphine.glb (lead only;
                                  backup -> progress/tmp/seraphine_r29/promote_backup/).
"""
import argparse
import importlib
import json
import os
import re
import shutil
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
from lib import meshutil, pipeline, skin  # noqa: E402
import seraphine_r29_team as T  # noqa: E402

importlib.reload(T)
ARGS = {}


def log(msg):
    print(f"[seraphine-r29] {msg}", flush=True)


# ------------------------------------------------------------------------------------------------ blender helpers
def import_armature():
    """r28 armature only (bone rolls/sockets as exported); meshes + orphan data removed so names stay clean."""
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


def retarget_armature(arm, R):
    """Move the rest joints to R.joints (body role's retarget.json). Rolls, hierarchy and names unchanged."""
    if not R.maps:
        return {"moved": 0}
    meshutil.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    err, moved = {}, 0
    for b in arm.data.edit_bones:
        if b.name not in R.maps:
            continue
        m = R.maps[b.name]
        h = np.array(b.head[:])
        err[b.name] = float(np.linalg.norm(h - m["old"]))
        off = 0.0 if R.parent[b.name] is None else R.dz
        roll = b.roll
        nh = T.T0.apply_map(m, h[None])[0] + [0, 0, off]
        nt = T.T0.apply_map(m, np.array(b.tail[:])[None])[0] + [0, 0, off]
        if np.linalg.norm(nh - h) > 1e-6:
            moved += 1
        b.head, b.tail, b.roll = nh, nt, roll
    bpy.ops.object.mode_set(mode="OBJECT")
    bad = {k: round(v * 1000, 2) for k, v in err.items() if v > 1e-3}
    if bad:
        log(f"WARN armature heads differ from the r28 joints by > 1 mm: {bad}")
    return {"moved": moved, "max_head_mismatch_mm": round(max(err.values()) * 1000, 3) if err else 0}


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


def tile_map_paths(role, tile):
    d = os.path.join(T.PARTS_DIR, role, "tiles")
    out = {k: os.path.join(d, f"{tile}_{k}.png") for k in ("albedo", "orm", "normal")}
    for p in out.values():
        if not os.path.exists(p):
            raise FileNotFoundError(f"{p} (the {role} role ships its tile PNGs with its parts)")
    return out


def r28_map_paths(sheet):
    pre = "r28_groom" if sheet == "groom" else "r28_body"
    return {k: os.path.join(T.RIG_DIR, f"{pre}_{k}.webp") for k in ("albedo", "orm", "normal")}


def material_for(name, paths, alpha=False, cutoff=0.4):
    if alpha:
        import seraphine_hair_cards as cards   # proven r18 MASK card material (read-only import)
        return cards.card_material(name, paths["albedo"], paths["normal"], paths["orm"], cutoff=cutoff)
    ims = load_images(paths, name)
    return pipeline.final_material(name, ims["albedo"], ims["normal"], ims["orm"])


def patch_extras(path, per_material):
    """glTF material extras/extensions after export: kcaRimScale, MASK cutoff, KHR_materials_specular, kcaMeta."""
    raw = open(path, "rb").read()
    n = struct.unpack_from("<I", raw, 12)[0]
    obj = json.loads(raw[20:20 + n])
    for m in obj.get("materials", []):
        nm = re.sub(r"\.\d{3}$", "", m.get("name") or "")
        spec = per_material.get(nm)
        if not spec:
            continue
        ex = m.setdefault("extras", {})
        ex.update(spec.get("extras", {}) or {})
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


# ------------------------------------------------------------------------------------------------ assembly
def role_parts(role):
    d = os.path.join(T.PARTS_DIR, role)
    skip = set(ARGS.get("skip_parts", ()))
    parts = []
    for nm in T.list_parts(d):
        if nm in skip:
            continue
        p = T.load_part(d, nm)
        if p["meta"].get("rig_sha") != T.DONOR_SHA:
            raise RuntimeError(f"{role}/{nm}: rig_sha mismatch")
        parts.append((role, p))
    return parts


def assemble(R, roles):
    """Groups keyed (mesh, tile, alpha, role) -> concatenated arrays in the FINAL frame. Returns (groups, report)."""
    rep = {"roles": roles, "parts": {}, "tris": {}}
    groups = {}

    def add(key, P, F, UV, N, Wn):
        if len(F) == 0:
            return
        g = groups.setdefault(key, {"P": [], "F": [], "UV": [], "N": [], "W": [], "n": 0})
        g["P"].append(P); g["F"].append(F + g["n"]); g["UV"].append(UV); g["N"].append(N); g["W"].append(Wn)
        g["n"] += len(P)

    anim_w = None
    if ARGS.get("weights") == "anim":
        p = os.path.join(T.PARTS_DIR, "anim", "weights_body.npz")
        if os.path.exists(p):
            z = np.load(p)
            anim_w = {"W": z["W"], "bones": [str(b) for b in z["bones"]], "body_sha": str(z["body_sha"]) if "body_sha" in z.files else None}
            log(f"anim weights for the body: {p}")
    # lead 11:10: with --weights anim the costume must deform like the skin it sits on -> re-transfer every non-chain part's
    # weights from the anim-weighted body (same allow-lists as the roles used); parts on kilt_*/hair_* chains keep their own.
    body_anim = None
    if anim_w is not None:
        bp = T.load_body()
        body_anim = {"P": bp["P"], "W": T.T0.dense_weights(anim_w["W"], anim_w["bones"], R.bones), "bones": list(R.bones)}
        rep["weights_retransfer"] = []
    for role in roles:
        for _, p in role_parts(role):
            W, bones = p["W"], p["bones"]
            name = p["meta"]["name"]
            if role == "body" and name == "body" and anim_w is not None:
                if anim_w["body_sha"] and anim_w["body_sha"] != T.part_sha(os.path.join(T.PARTS_DIR, "body"), "body"):
                    raise RuntimeError("anim weights_body.npz was made for another body.npz (sha mismatch)")
                if len(anim_w["W"]) != len(p["P"]):
                    raise RuntimeError("anim weights_body.npz vertex count != body.npz")
                W, bones = anim_w["W"], anim_w["bones"]
            elif role in ("armour", "hair") and body_anim is not None:
                used = [b for b, wsum in zip(bones, np.asarray(W).sum(0)) if wsum > 0]
                # r30 opt-in: parts whose meta says weights_final (raised bands built from the anim-weighted body with
                # along-band smoothing) keep their own weights; absent = r29 behaviour.
                if not any(b.startswith(("kilt_", "hair_")) for b in used) and not p["meta"].get("weights_final"):
                    base = name.split("__")[0]
                    allow = T.ARMOUR_ALLOW.get(base) if role == "armour" else ("head",)
                    Wfull, bfull = T.transfer_weights(np.asarray(p["P"], np.float64), body_anim, allow=None)
                    keep = np.isin(bfull, list(allow)) if allow else np.ones(len(bfull), bool)
                    Wm = Wfull * keep[None]
                    dead = Wm.sum(1) < 1e-6                      # allow-list bones carry nothing here -> keep the role's weights
                    Wm = T.top_k(Wm, 4)
                    Wrole = T.T0.dense_weights(np.asarray(W, np.float32), list(bones), list(bfull))
                    Wm[dead] = Wrole[dead]
                    W, bones = Wm, list(bfull)
                    rep["weights_retransfer"].append(f"{role}/{name}" + (f" (kept {int(dead.sum())} rows)" if dead.any() else ""))
            Wn = T.T0.dense_weights(W, bones, R.bones)
            add((p["meta"]["mesh"], p["meta"]["tile"], bool(p["meta"].get("alpha")), role), p["P"], p["F"], p["UV"], p["N"], Wn)
            rep["parts"][f"{role}/{p['meta']['name']}"] = {"tris": int(len(p["F"])), "tile": p["meta"]["tile"]}
    for key, g in groups.items():
        for k in ("P", "F", "UV", "N", "W"):
            g[k] = np.concatenate(g[k])
        rep["tris"]["/".join(str(x) for x in key)] = int(len(g["F"]))
    rep["tris_total"] = int(sum(len(g["F"]) for g in groups.values()))
    return groups, rep


def smoke_groups(R):
    """r28 meshes as two groups (bpy half check only)."""
    groups = {}
    for mk in ("body", "groom"):
        m = R.donor_mesh(mk)
        groups[(mk, f"r28_{mk}", mk == "groom", "r28")] = {"P": m["P"], "F": m["F"], "UV": m["UV"], "N": m["N"], "W": m["Wn"]}
    return groups


def build_objects(groups, arm, R):
    """Preview materials: tile PNGs per (sheet, tile); r28 maps for the smoke groups."""
    objs, extras, mats = [], {}, {}
    for key, g in sorted(groups.items(), key=lambda kv: str(kv[0])):
        mk, tile, alpha, role = key
        if tile.startswith("r28_"):
            sheet = tile[4:]
            name = T.CONFIG["sheets"][sheet]["material"]
            paths, a = r28_map_paths(sheet), sheet == "groom"
        else:
            sheet = T.CONFIG["tiles"][tile][0]
            name = f"M_sera29_{role}_{tile}" + ("_alpha" if alpha else "")
            paths, a = tile_map_paths(role, tile), alpha or sheet == "groom"
        if name not in mats:
            sh = T.CONFIG["sheets"][sheet]
            mats[name] = material_for(name, paths, alpha=a, cutoff=sh.get("cutoff", 0.4))
            extras[name] = {"rim": sh.get("rim"), "alpha": "MASK" if a else None, "cutoff": sh.get("cutoff", 0.4),
                            "specular": sh.get("specular") if sheet == "groom" else None, "extras": sh.get("extras", {})}
        obname = (T.MESH_NAMES[mk]) + f"_{tile}_{role}" + ("_alpha" if alpha else "")   # lead 10:48: unique names (no ".001")
        ob = object_from_arrays(obname, g["P"], g["F"], g["UV"], g["N"], g["W"], R.bones, arm)
        ob.data.materials.append(mats[name])
        objs.append(ob)
    return objs, extras


# ------------------------------------------------------------------------------------------------ main
def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--preview-role", choices=T.ROLES)
    ap.add_argument("--no-body", action="store_true", help="preview a role without the body part")
    ap.add_argument("--integrate", action="store_true")
    ap.add_argument("--roles", default=",".join(T.ROLES))
    ap.add_argument("--weights", choices=("role", "anim"), default="role")
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
    R = T.Rig()                                   # retarget = parts/body/retarget.json if present
    ARGS.update(R=R, release=a.release, skip_parts=[x for x in a.skip_parts.split(",") if x], weights=a.weights)
    arm = import_armature()
    rep_arm = retarget_armature(arm, R)
    log(f"stage armature done in {time.time()-t0:.1f}s retarget={'on' if R.maps else 'off'} {rep_arm}")
    if a.smoke:
        groups, rep = smoke_groups(R), {"mode": "smoke"}
        rep["tris_total"] = int(sum(len(g["F"]) for g in groups.values()))
    else:
        if a.preview_role:
            roles = [a.preview_role] if (a.no_body or a.preview_role == "body") else ["body", a.preview_role]
        else:
            roles = [r for r in a.roles.split(",") if r]
        groups, rep = assemble(R, roles)
    rep["armature"] = rep_arm
    log(f"stage assemble done in {time.time()-t0:.1f}s tris={rep['tris_total']}")
    if rep["tris_total"] > T.CONFIG["budget"]["total_cap"]:
        log(f"WARN tris {rep['tris_total']} > cap {T.CONFIG['budget']['total_cap']}")
    objs, extras = build_objects(groups, arm, R)
    if a.integrate and not a.no_pack:
        try:
            import seraphine_r29_texture        # texture artist's module (pack_sheets)
            importlib.reload(seraphine_r29_texture)
            packed = seraphine_r29_texture.pack_sheets(groups, objs, arm, fast=a.fast, release=a.release)
            objs, extras = packed["objects"], packed["materials"]
            rep["pack"] = packed["report"]
        except ImportError:
            log("WARN blender/seraphine_r29_texture.py missing: exporting preview materials (QA only, not a release)")
            rep["pack"] = "preview-materials"
    else:
        rep["pack"] = "preview-materials"
    path = os.path.join(out, "hero_seraphine.glb")
    pipeline.export_glb(path, [arm] + objs, scene_name="hero_seraphine")
    patch_extras(path, extras)
    rep.update(mode="smoke" if a.smoke else ("preview:" + a.preview_role if a.preview_role else "integrate"),
               glb=path, rig_sha=T.DONOR_SHA, skip_parts=ARGS["skip_parts"], weights=a.weights,
               seconds=round(time.time() - t0, 1))
    T.T0.save_json(os.path.join(out, "seraphine_r29_report.json"), rep)
    log(f"DONE {path} ({rep['tris_total']} tris, {rep['seconds']}s)")
    if a.promote:
        if not (a.integrate and a.release) or rep.get("pack") == "preview-materials":
            raise RuntimeError("--promote needs a packed --integrate --release build")
        dst = os.path.join(T.ROOT, "public", "assets", "models", "hero_seraphine.glb")
        bak = os.path.join(T.TEAM, "promote_backup")
        os.makedirs(bak, exist_ok=True)
        if os.path.exists(dst):
            prev = T.T0.sha256(dst)
            shutil.copy2(dst, os.path.join(bak, f"hero_seraphine.{prev[:12]}.glb"))
            log(f"backup of the live GLB ({prev}) -> {bak}")
        tmp = dst + ".tmp"
        shutil.copy2(path, tmp)
        os.replace(tmp, dst)
        log(f"promoted -> {dst} sha256 {T.T0.sha256(dst)}")


if __name__ == "__main__":
    main()
