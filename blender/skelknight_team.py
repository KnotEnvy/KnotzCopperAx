"""Skeleton + Hollow Knight team (C2 r22, item enemies-art-2): small shared helpers. Owner: the model LEAD.

Builders and the texture artist IMPORT this module and never edit it (ask the lead in your notes). Pure Python +
numpy, no bpy at import, so it also runs under Blender's bundled python without a Blender slot:
  ~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 -I blender/skelknight_team.py --selftest
  ... blender/skelknight_team.py --check-glb <file.glb> [--family skeleton|knight|weapon] [--tier <t>]

What lives here (and nowhere else):
  - TEAM paths + `out_dir()`: every team build writes to progress/tmp/skelknight_team/<family>/... NEVER public/.
  - `tier_pal(family, tier, defaults)`: the build-time palette = builder defaults <- palettes BASE <- palettes TIER
    (data in blender/skelknight_palettes.py, owned by the texture artist; re-imported each call so a running
    Blender session sees edits).
  - BUDGETS: per-asset triangle caps (blueprint "Budgets"); `--check-glb` checks them + material count + extras.
  - `patch_extras(glb, {material: {"rim": x}})`: glTF material extras (kcaRimScale) written after export
    (blender/lib/pipeline.export_glb exports with export_extras=False).
  - `write_status()`: the builder <-> QA critic loop file.
  - `promote()`: copies a release GLB set into public/ with SHA256 records. LEAD (integration) ONLY.
"""
import hashlib
import importlib
import json
import os
import shutil
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEAM = os.path.join(ROOT, "progress", "tmp", "skelknight_team")
PUBLIC_MODELS = os.path.join(ROOT, "public", "assets", "models")
QA_DIR = os.path.join(ROOT, "progress", "qa", "model", "enemies_skelknight")
SHOTS = os.path.join(ROOT, "progress", "shots", "enemies-art-2", "r22-team")
DONOR_DIR = os.path.join(TEAM, "lead", "donor")   # Sept 2026 shipped GLBs (read-only snapshot, SHA in donor.json)

FAMILIES = {
    "skeleton": {"tiers": ["white", "purple"], "asset": "enemy_skeleton", "alias": "white", "weapon": "weapon_sword_bone"},
    "knight": {"tiers": ["silver", "red", "gold"], "asset": "enemy_knight", "alias": "silver", "weapon": "weapon_halberd"},
}

# Exported triangle caps per GLB (body + glow, incl. embedded shield). Blueprint "Budgets" (horde-aware).
BUDGETS = {
    "enemy_skeleton_white": 12000, "enemy_skeleton_purple": 14500,
    "enemy_knight_silver": 16000, "enemy_knight_red": 16500, "enemy_knight_gold": 17500,
    "weapon_sword_bone": 2000, "weapon_halberd": 3000,
}
MAX_MATERIALS = 2          # body + glow (eyes). A third material needs the lead's OK (draw calls x horde size).


def out_dir(family, role, *parts):
    """progress/tmp/skelknight_team/<family>/<role>/<parts...> (created). Refuses anything under public/."""
    p = os.path.join(TEAM, family, role, *[str(x) for x in parts])
    if os.path.abspath(p).startswith(os.path.join(ROOT, "public")):
        raise RuntimeError("team builds never write to public/ (only skelknight_team.promote does)")
    os.makedirs(p, exist_ok=True)
    return p


def guard_out(path):
    """Raise if a build output path points into public/ (call this on --out in the team builders)."""
    if os.path.abspath(path).startswith(os.path.join(ROOT, "public")):
        raise RuntimeError(f"refusing to write {path}: team builds go to progress/tmp/skelknight_team/")
    return path


def tier_pal(family, tier, defaults):
    """Merged linear-RGB palette dict for one tier: `defaults` (the builder's own PAL, incl. keys for NEW parts)
    <- skelknight_palettes.BASE[family] <- skelknight_palettes.TIERS[family][tier]. Values are what the builder's
    painters expect (linear RGB np arrays via shaders.srgb, floats, tuples)."""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import skelknight_palettes as SP
    importlib.reload(SP)
    p = dict(defaults)
    p.update(SP.base(family))
    p.update(SP.tier(family, tier))
    return p


def rim_scales(family, tier):
    """{material_name: {"rim": x}} for patch_extras, from skelknight_palettes.RIM."""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import skelknight_palettes as SP
    importlib.reload(SP)
    asset = f"{FAMILIES[family]['asset']}_{tier}"
    r = SP.RIM.get(family, {})
    out = {}
    if r.get("body") is not None:
        out[f"M_{asset}"] = {"rim": r["body"]}
    if r.get("glow") is not None:
        out[f"M_{asset}_glow"] = {"rim": r["glow"]}
    return out


# ------------------------------------------------------------------------------------------------ GLB json
def read_gltf_json(path):
    raw = open(path, "rb").read()
    if raw[:4] != b"glTF":
        raise ValueError(f"{path}: not a GLB")
    n = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + n]), raw, n


def patch_extras(path, per_material):
    """Write glTF material extras (kcaRimScale; optional MASK) after export. Same as build_hero_brann_team.patch_extras."""
    import re
    obj, raw, n = read_gltf_json(path)
    for m in obj.get("materials", []):
        nm = m.get("name") or ""
        spec = per_material.get(nm) or per_material.get(re.sub(r"\.\d{3}$", "", nm))
        if not spec:
            continue
        if spec.get("rim") is not None:
            m.setdefault("extras", {})["kcaRimScale"] = float(spec["rim"])
        for k, v in (spec.get("extras") or {}).items():
            m.setdefault("extras", {})[k] = v
        if spec.get("alpha") == "MASK":
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = float(spec.get("cutoff", 0.45))
            m["doubleSided"] = True
    js = json.dumps(obj, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    tail = raw[20 + n:]
    out = struct.pack("<III", 0x46546C67, 2, 20 + len(js) + len(tail)) + struct.pack("<II", len(js), 0x4E4F534A) + js + tail
    open(path, "wb").write(out)


def glb_summary(path):
    """Triangles per material, materials, extras, bone names, texture sizes (from the JSON chunk only)."""
    obj, raw, n = read_gltf_json(path)
    acc = obj.get("accessors", [])
    tris = {}
    for mesh in obj.get("meshes", []):
        for pr in mesh.get("primitives", []):
            mi = pr.get("material")
            nm = obj["materials"][mi].get("name", str(mi)) if mi is not None else "none"
            c = acc[pr["indices"]]["count"] // 3 if "indices" in pr else acc[pr["attributes"]["POSITION"]]["count"] // 3
            tris[nm] = tris.get(nm, 0) + c
    bones = [obj["nodes"][j].get("name") for s in obj.get("skins", []) for j in s.get("joints", [])]
    return {"tris": sum(tris.values()), "tris_per_material": tris,
            "materials": [m.get("name") for m in obj.get("materials", [])],
            "extras": {m.get("name"): m.get("extras", {}) for m in obj.get("materials", [])},
            "bones": bones, "nodes": [nd.get("name") for nd in obj.get("nodes", [])],
            "mb": round(os.path.getsize(path) / 1e6, 2)}


def check_glb(path, family=None, tier=None, ref_bones=None):
    """Team contract check (no Blender): budget, material count, kcaRimScale present, bone list unchanged vs ref."""
    s = glb_summary(path)
    name = os.path.splitext(os.path.basename(path))[0]
    cap = BUDGETS.get(name)
    res = {"glb": path, "tris": s["tris"], "cap": cap, "materials": s["materials"], "mb": s["mb"], "checks": []}

    def chk(ok, what):
        res["checks"].append({"ok": bool(ok), "check": what})
    if cap:
        chk(s["tris"] <= cap, f"tris {s['tris']} <= {cap}")
    if name.startswith("enemy_"):
        chk(len(s["materials"]) <= MAX_MATERIALS, f"materials {len(s['materials'])} <= {MAX_MATERIALS}")
        chk(any("kcaRimScale" in (e or {}) for e in s["extras"].values()), "kcaRimScale on the body material")
        ref = ref_bones
        if ref is None and family in FAMILIES:
            donor = os.path.join(DONOR_DIR, f"{FAMILIES[family]['asset']}_{FAMILIES[family]['alias']}.glb")
            if os.path.exists(donor):
                ref = glb_summary(donor)["bones"]
        if ref is not None:
            chk(s["bones"] == ref, f"bone list identical to the shipped rig ({len(ref)} bones)")
    if name.startswith("weapon_"):
        for nd in ("grip_main",):
            chk(nd in s["nodes"], f"node {nd} present")
    res["ok"] = all(c["ok"] for c in res["checks"])
    return res


# ------------------------------------------------------------------------------------------------ loop + promote
def write_status(family, role, it, glb, qa, what_changed, self_check, ready=True, extra=None):
    d = out_dir(family, role)
    st = {"family": family, "role": role, "iter": it, "glb": glb, "qa": qa, "ready_for_review": ready,
          "what_changed": what_changed, "self_check": self_check, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    st.update(extra or {})
    with open(os.path.join(d, "status.json"), "w") as f:
        json.dump(st, f, indent=1)
    return st


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def promote(src_dir, names, note=""):
    """LEAD ONLY (integration gate passed). Copy <src_dir>/<name>.glb -> public/assets/models/, keeping the old file
    as progress/tmp/skelknight_team/lead/promoted_backup/<name>.glb, and record SHA256s. Also refreshes the alias
    files enemy_skeleton.glb (= white) / enemy_knight.glb (= silver) when their tier is promoted."""
    bk = out_dir("lead", "promoted_backup")
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "note": note, "files": {}}
    for nm in names:
        src = os.path.join(src_dir, nm + ".glb")
        dst = os.path.join(PUBLIC_MODELS, nm + ".glb")
        if os.path.exists(dst) and not os.path.exists(os.path.join(bk, nm + ".glb")):
            shutil.copyfile(dst, os.path.join(bk, nm + ".glb"))
        shutil.copyfile(src, dst)
        rec["files"][nm] = {"sha256": sha256(dst), "old_sha256": sha256(os.path.join(bk, nm + ".glb")) if os.path.exists(os.path.join(bk, nm + ".glb")) else None}
        for fam in FAMILIES.values():
            if nm == f"{fam['asset']}_{fam['alias']}":
                shutil.copyfile(dst, os.path.join(PUBLIC_MODELS, fam["asset"] + ".glb"))
                rec["files"][fam["asset"]] = {"sha256": rec["files"][nm]["sha256"], "alias_of": nm}
    with open(os.path.join(TEAM, "lead", "promoted.json"), "w") as f:
        json.dump(rec, f, indent=1)
    return rec


def _selftest():
    import tempfile
    for fam, info in FAMILIES.items():
        for t in info["tiers"]:
            p = tier_pal(fam, t, {"probe": 1})
            assert p["probe"] == 1 and len(p) > 1, (fam, t)
        rs = rim_scales(fam, info["tiers"][0])
        assert isinstance(rs, dict)
    for nm in ("enemy_skeleton_white", "enemy_knight_silver", "weapon_halberd"):
        src = os.path.join(PUBLIC_MODELS, nm + ".glb")
        if not os.path.exists(src):
            continue
        tmp = os.path.join(tempfile.mkdtemp(), nm + ".glb")
        shutil.copyfile(src, tmp)
        fam = "skeleton" if "skeleton" in nm else "knight" if "knight" in nm else None
        before = glb_summary(tmp)
        patch_extras(tmp, {m: {"rim": 0.5} for m in before["materials"]})
        after = glb_summary(tmp)
        assert after["tris"] == before["tris"] and all(e.get("kcaRimScale") == 0.5 for e in after["extras"].values())
        print(nm, json.dumps(check_glb(tmp, fam)))
    try:
        guard_out(os.path.join(ROOT, "public", "x.glb"))
        raise AssertionError("guard_out let public/ through")
    except RuntimeError:
        pass
    print("selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        _selftest()
    elif "--check-glb" in a:
        g = a[a.index("--check-glb") + 1]
        fam = a[a.index("--family") + 1] if "--family" in a else None
        tr = a[a.index("--tier") + 1] if "--tier" in a else None
        r = check_glb(g, fam, tr)
        print(json.dumps(r, indent=1))
        sys.exit(0 if r["ok"] else 1)
    else:
        print(__doc__)
