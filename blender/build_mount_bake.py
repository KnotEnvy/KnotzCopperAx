"""r2 baked pipeline for the bizarrians (critic r1: vertex-colour primitive soup). Not a build itself.

Every piece is an SDF sculpt -> HI mesh (fine voxel, painted per material with numpy painters + node-side micro
detail: shingled scales, ventral plates, grain) -> LO game mesh (collapse-decimated) -> SDF skin (organic) or rigid
bind (hard parts, can never tear) -> smart UV -> one shared atlas -> Cycles bake (albedo / prm / AO / normal) ->
composite (albedo, ORM, normal PNG under public/assets/textures/<asset>_*) -> one PBR material -> skinned GLB.
"""
import os
import time
import importlib

import numpy as np
import bpy

import build_mount_kit as K
from lib import charkit, shaders, pipeline, meshutil, skin
for _m in (charkit, shaders):
    importlib.reload(_m)

LOG = pipeline.LOG
jv = K.jv
OUT_TEX = os.path.join(K.ROOT, "public", "assets", "textures")
_ORIG_MICRO = shaders._micro


def _micro_beast(nb, recipe, obj_co, uv):
    """Creature micro detail (delegates everything else to lib/shaders._micro).
    scales*: overlapping reptile scales -- Voronoi cells stretched along the body (Blender Y = the beast's length),
    each a dome whose tail-ward edge rides higher (shingled), dark crevices, per-cell tint jitter.
    plate: smooth ventral-plate skin with fine transverse wrinkles. feather: barbs."""
    if recipe in ("scales", "scales_fine", "scales_big"):
        sc = {"scales": 36.0, "scales_fine": 70.0, "scales_big": 22.0}[recipe]
        co = nb.vmath("MULTIPLY", obj_co, (1.0, 0.72, 1.0))
        v1 = nb.n("ShaderNodeTexVoronoi", feature="F1")
        v1.inputs["Scale"].default_value = sc
        v1.inputs["Randomness"].default_value = 0.85
        nb.link(co, v1.inputs["Vector"])
        v2 = nb.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        v2.inputs["Scale"].default_value = sc
        v2.inputs["Randomness"].default_value = 0.85
        nb.link(co, v2.inputs["Vector"])
        edge = nb.math("MINIMUM", nb.math("MULTIPLY", v2.outputs["Distance"], 4.0), 1.0)
        dome = nb.math("POWER", edge, 0.55)
        sep_c = nb.n("ShaderNodeSeparateXYZ")
        nb.link(co, sep_c.inputs[0])
        sep_p = nb.n("ShaderNodeSeparateXYZ")
        nb.link(v1.outputs["Position"], sep_p.inputs[0])
        dy = nb.math("SUBTRACT", nb.math("MULTIPLY", sep_c.outputs["Y"], sc), sep_p.outputs["Y"])
        shing = nb.math("ADD", nb.math("MULTIPLY", dy, 0.9), 0.5, clamp=True)
        h = nb.math("MULTIPLY", dome, nb.math("ADD", nb.math("MULTIPLY", shing, 0.55), 0.45))
        rnd = nb.n("ShaderNodeSeparateColor")
        nb.link(v1.outputs["Color"], rnd.inputs["Color"])
        alb = nb.math("MULTIPLY", nb.math("ADD", nb.math("MULTIPLY", h, 0.5), 0.52),
                      nb.math("ADD", nb.math("MULTIPLY", rnd.outputs["Red"], 0.22), 0.89))
        rough = nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, h), 0.18)
        return h, alb, rough, {"scales": 0.0032, "scales_fine": 0.0018, "scales_big": 0.005}[recipe]
    if recipe == "plate":
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 60.0
        noi.inputs["Detail"].default_value = 5.0
        nb.link(obj_co, noi.inputs["Vector"])
        wav = nb.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Y")
        wav.inputs["Scale"].default_value = 90.0
        wav.inputs["Distortion"].default_value = 3.0
        nb.link(obj_co, wav.inputs["Vector"])
        h = nb.math("ADD", nb.math("MULTIPLY", noi.outputs["Fac"], 0.6), nb.math("MULTIPLY", wav.outputs["Fac"], 0.25))
        alb = nb.math("ADD", nb.math("MULTIPLY", noi.outputs["Fac"], 0.1), 0.95)
        return h, alb, None, 0.0008
    if recipe == "feather":
        wav = nb.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X")
        wav.inputs["Scale"].default_value = 160.0
        wav.inputs["Distortion"].default_value = 2.0
        wav.inputs["Detail"].default_value = 2.0
        nb.link(obj_co, wav.inputs["Vector"])
        alb = nb.math("ADD", nb.math("MULTIPLY", wav.outputs["Fac"], 0.16), 0.9)
        return wav.outputs["Fac"], alb, None, 0.0006
    return _ORIG_MICRO(nb, recipe, obj_co, uv)


shaders._micro = _micro_beast
shaders.MICRO.update({"scale": "scales", "scale_fine": "scales_fine", "scale_big": "scales_big", "belly": "plate",
                      "horn": "grain", "claw": "grain", "spine": "grain", "frill": "pores", "mouth": "pores",
                      "teeth": "none", "eye": "none", "brass": "hammered", "leather": "grain", "cloth": "weave",
                      "feather": "feather", "beak": "grain", "down": "strands_world", "rope": "grain"})


def ray_out(S, c_js, d_js, r_max=0.6):
    """Surface point (JS frame) hit by a ray from an interior point c along d (both JS frame)."""
    p = charkit.ray_hit(S, jv(c_js), jv(d_js), r_max=r_max)
    return (float(p[0]), float(p[2]), float(-p[1]))


def bake_build(asset, arm, jobs, painters, pal, fast=False, extra=None, stretch_poses=(), out_glb=None, report=None):
    """jobs: [dict(key, S, h_hi, h_lo, tris, bind=('skin', allowed[, overrides]) | ('rigid', bone), sym=True,
    uv=(angle, density), ext=(extrusion, max_ray), lo=None, hi=None, islands=True, S_lo=None)] -> exported GLB path.
    S_lo (r3): a separate, smoother sculpt for the LO game mesh + skin weights (e.g. feather-group masses only) while
    the HI bake source S carries the fine detail (individual feathers) -> detail lives in the normal/albedo maps."""
    T0 = time.time()
    res = 1024 if fast else 2048
    rep = report if report is not None else {}
    rep.update(asset=asset, res=res, fast=fast, parts={}, geom_qa={})
    rep["device"] = pipeline.setup_cycles("AUTO")
    his, los = {}, {}
    for j in jobs:
        k, S = j["key"], j["S"]
        lo, hi = j.get("lo"), j.get("hi")
        t = time.time()
        o = pipeline.sculpt_mesh(S, k + "_hi", j["h_hi"], lo, hi)
        if j.get("islands", True):
            charkit.drop_islands(o, j["h_hi"], min_verts=40)
        his[k] = o
        lp = pipeline.lowpoly(j.get("S_lo") or S, k + "_lo", j["h_lo"], j["tris"], lo, hi, symmetry=j.get("sym", True),
                              smooth=j.get("smooth", 0))
        if j.get("islands", True):
            charkit.drop_islands(lp, j["h_lo"], min_verts=24)
        lp.data.validate()
        los[k] = lp
        rep["parts"][k] = meshutil.tri_count(lp)
        rep["geom_qa"][k] = charkit.geom_qa(lp)
        LOG(f"[{asset}] {k}: hi {len(o.data.vertices)} v, lo {rep['parts'][k]} tris ({time.time() - t:.1f}s)")
    for j in jobs:
        k, b = j["key"], j["bind"]
        if b[0] == "skin":
            skin.skin(los[k], arm, method="sdf", S=j.get("S_lo") or j["S"], allowed=b[1], overrides=b[2] if len(b) > 2 else (),
                      power=4.0, smooth=5, restrict=False)
        else:
            charkit.rigid_bind(los[k], arm, b[1])
    for j in jobs:
        a, dns = j.get("uv", (66.0, 1.0))
        charkit.smart_uv(los[j["key"]], a, dns)
    order = [j["key"] for j in jobs]
    rep["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=4 if fast else 6, res=res)
    for j in jobs:
        k, S = j["key"], j["S"]
        shaders.assign_bake_materials(his[k], S.materials, prefix=f"bk_{asset}_{k}_")
        shaders.paint_mesh(his[k], S.materials, {}, pal, extra or {}, painters=painters)
    for o in list(his.values()) + list(los.values()):
        pipeline.set_ray_visibility(o, False)
    bj = [(los[j["key"]], [his[j["key"]]]) + tuple(j.get("ext", (0.01, 0.03))) for j in jobs]
    B = pipeline.Baker(res, bj, shaders.set_pass, [los[k] for k in order], [his[k] for k in order])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                         ("normal", "NORMAL", 4 if fast else 8)])
    tex = charkit.composite_maps(maps, OUT_TEX, asset, tint=(0.40, 0.32, 0.42))
    mat = pipeline.final_material("M_" + asset, tex["albedo"], tex["normal"], tex["orm"])
    dups = []
    for k in order:
        o = meshutil.duplicate(los[k], k + "_x")
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
        dups.append(o)
    bpy.context.view_layer.update()
    body = meshutil.join(dups, asset + "_mesh")
    body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
    for m in list(body.modifiers):
        if m.type == 'ARMATURE' and m.object is not arm:
            body.modifiers.remove(m)
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        skin.bind(body, arm)
    rep["tris"] = meshutil.tri_count(body)
    if stretch_poses:
        rep["stretch_worst"] = K.stretch_check(body, arm, stretch_poses)
    out = out_glb or os.path.join(K.ROOT, "public", "assets", "models", asset + ".glb")
    pipeline.export_glb(out, [arm, body], scene_name=asset)
    if out_glb is None:                     # r3: repair inverted baked normals (pale-blue flank discs) -> PNG + GLB
        import subprocess
        fx = os.path.join(K.HERE, "build_mount_fixnormals.py")
        try:
            LOG(subprocess.run(["python", fx, asset], capture_output=True, text=True, timeout=300).stdout.strip())
        except Exception as e:              # system python/Pillow missing: run it by hand after the build
            LOG(f"[{asset}] fixnormals FAILED ({e}); run: python blender/build_mount_fixnormals.py {asset}")
    rep["glb"] = out
    rep["glb_mb"] = round(os.path.getsize(out) / 1e6, 2)
    rep["seconds"] = round(time.time() - T0)
    pipeline.write_json(os.path.join(K.HERE, "out", asset + "_report.json"), rep)
    LOG(f"[{asset}] DONE {rep['tris']} tris, {rep['glb_mb']} MB, {rep['seconds']}s")
    return out


def preview(asset, jobs, out_png, views, colors):
    """Clay look-dev of the sculpts (Workbench, material colours) -- fast silhouette iteration before a bake."""
    from lib import preview as pv
    pv.setup_workbench("MATERIAL")
    for j in jobs:
        charkit.mesh_sculpt(j.get("S_lo") or j["S"], j["key"], j.get("h_prev", j["h_lo"]), j.get("lo"), j.get("hi"), colors=colors)
    pv.render_views(out_png, views, res=(900, 700))
