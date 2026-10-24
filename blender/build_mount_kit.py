"""Shared helpers for the bizarrian (mount) creature builds (build_mount_<id>.py). Not a build itself.

Authoring frame = the game/JS model frame: Y up, +Z = the beast's forward, +X = the beast's LEFT (metres, feet on
Y=0). J() converts to Blender (Z up, faces -Y, left = +X), so the exported glTF (+Y up, faces +Z) lands back in the
JS frame exactly and the bone names / joint positions match src/mounts/types/<id>.js (procedural fallback) and the
pose driver in src/mounts/beastRig.js (rotations are applied in model axes, so Blender bone rolls don't matter).

Pipeline per creature:
  body  = one SDF sculpt (smooth unions) -> lowpoly -> SDF skin weights (visibility-penalised by the sculpt, so
          weights never jump across gaps: legs vs belly, tail vs thighs)
  parts = hard pieces (beak, horns, spikes, saddle, claws...) sculpted separately and weighted RIGIDLY to one bone
          (they can never tear: every vertex follows exactly one bone)
  paint = per-vertex colour (COLOR_0, linear) from a palette function + curvature cavity/ridge + fbm mottling;
          one 'organic' material and one 'metal' material (vertex colours multiply base colour white)
"""
import os
import sys
import math
import time
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import bpy

from lib import sdf, meshutil, pipeline, skin
for _m in (sdf, meshutil, pipeline, skin):
    importlib.reload(_m)
from lib.sdf import V, norm, basis  # noqa: F401

ROOT = os.path.dirname(HERE)
LOG = pipeline.LOG


def J(x, y, z):
    """JS model frame (Y up, +Z forward, +X left) -> Blender (Z up, -Y forward, +X left)."""
    return V(x, -z, y)


def jv(p):
    return J(*p)


def hexlin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return pipeline.srgb2lin(c)


# ----------------------------------------------------------------------------------------------- armature
def make_armature(name, bones):
    """bones: [(name, head_js, tail_js, parent|None, deform)] -> armature object (rest = authored pose)."""
    arm = bpy.data.armatures.new(name + "_rig")
    ob = bpy.data.objects.new(name + "_rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, h, t, par, deform in bones:
        b = arm.edit_bones.new(n)
        b.head = tuple(jv(h)); b.tail = tuple(jv(t))
        b.use_deform = bool(deform)
        # roll: keep the bone's local Z pointing up-ish (stable, readable rolls; the JS driver doesn't care)
        b.align_roll((0.0, 0.0, 1.0) if abs(b.vector.normalized().z) < 0.9 else (0.0, -1.0, 0.0))
        if par:
            b.parent = eb[par]
            b.use_connect = False
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def body_mesh(S, name, h, tris, smooth=1):
    ob = pipeline.lowpoly(S, name, h, tris, symmetry=True, smooth=smooth)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def skin_body(ob, arm, S, allowed, power=4.0, smooth=5, overrides=()):
    names, W = skin.skin(ob, arm, method="sdf", S=S, allowed=allowed, overrides=overrides, power=power, smooth=smooth, restrict=False)
    return names, W


def rigid(ob, arm, bone):
    """Every vertex of `ob` -> `bone` (weight 1)."""
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    skin.bind(ob, arm)


def paint(ob, fn, cavity=0.55, ridge=0.25, mottle=0.12, seed=3):
    """fn(P_js (N,3), N_js (N,3)) -> sRGB colours (N,3). Adds cavity darkening / ridge lift / fbm mottle."""
    P = meshutil.get_verts(ob, world=True)
    Nn = pipeline.vertex_normals(ob)
    Pj = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)
    Nj = np.stack([Nn[:, 0], Nn[:, 2], -Nn[:, 1]], 1)
    col = np.asarray(fn(Pj, Nj), dtype=np.float64)
    try:
        c_small, c_big = pipeline.curvature(ob, smooth_iters=(2, 10), scale=(30.0, 16.0))
    except Exception as e:  # tiny parts
        LOG("curvature fallback", e); c_small = np.zeros(len(P)); c_big = np.zeros(len(P))
    m = sdf.fbm(Pj[:, 0] * 1.0, Pj[:, 1] * 1.0, Pj[:, 2] * 1.0, 4, 5.0, seed=seed)
    k = 1.0 + ridge * np.clip(c_small, 0, 1) - cavity * np.clip(-c_small, 0, 1) - 0.25 * cavity * np.clip(-c_big, 0, 1) + mottle * (m - 0.5)
    col = np.clip(col * k[:, None], 0, 1)
    meshutil.add_color_attr(ob, "Col", pipeline.srgb2lin(col).astype(np.float32))


def material(name, rough=0.6, metal=0.0, emit=None, emit_strength=2.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emit, 1.0); break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_strength
    # vertex colour -> base colour (exported as COLOR_0; three multiplies it with the white base colour)
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def part(S, name, h, tris, arm, bone, colfn, mat, smooth=0, cavity=0.45):
    ob = pipeline.lowpoly(S, name, h, tris, symmetry=True, smooth=smooth)
    for p in ob.data.polygons:
        p.use_smooth = True
    paint(ob, colfn, cavity=cavity)
    ob.data.materials.append(mat)
    rigid(ob, arm, bone)
    return ob


def finish(name, arm, obs, out):
    """Join every skinned piece into one mesh (vertex groups merge by name), export GLB with the skeleton."""
    body = meshutil.join(obs, name)
    # keep only the Armature modifier bound to our rig
    for m in list(body.modifiers):
        if m.type == 'ARMATURE' and m.object is not arm:
            body.modifiers.remove(m)
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        skin.bind(body, arm)
    body.parent = arm
    # normalise weights to top-4
    import bmesh  # noqa: F401
    meshutil.select_only([arm, body], arm)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    kw = dict(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False,
              export_skins=True, export_all_influences=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        LOG("gltf kw fallback:", e)
        for k in ("export_vertex_color", "export_all_vertex_colors"):
            kw.pop(k, None)
        kw["export_colors"] = True
        bpy.ops.export_scene.gltf(**kw)
    LOG(f"[{name}] {meshutil.tri_count(body)} tris, {len(arm.data.bones)} bones -> {out} ({os.path.getsize(out) / 1e6:.2f} MB)")
    return body


def stretch_check(body, arm, poses):
    """Pose the rig (poses: [{bone: (rx, ry, rz) deg in bone-local}]) and report edges stretched > 3x & > 8 cm."""
    import mathutils
    E = pipeline.edges_of(body)
    rest = meshutil.get_verts(body, world=True)
    L0 = np.linalg.norm(rest[E[:, 0]] - rest[E[:, 1]], axis=1)
    worst = 0
    for i, pose in enumerate(poses):
        for pb in arm.pose.bones:
            pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
        for bn, r in pose.items():
            pb = arm.pose.bones.get(bn)
            if pb:
                pb.rotation_mode = 'XYZ'; pb.rotation_euler = tuple(math.radians(a) for a in r)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        P = np.array([body.matrix_world @ v.co for v in me.vertices])
        ev.to_mesh_clear()
        L1 = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
        badm = (L1 > L0 * 3.0) & (L1 > 0.08)
        bad = int(np.sum(badm))
        worst = max(worst, bad)
        info = ""
        if bad:
            names = [g.name for g in body.vertex_groups]
            W = skin.read_groups(body, names)
            dom = np.argmax(W, axis=1)
            pairs = {}
            for a, b in E[badm]:
                k = tuple(sorted((names[dom[a]], names[dom[b]])))
                pairs[k] = pairs.get(k, 0) + 1
            top = sorted(pairs.items(), key=lambda kv: -kv[1])[:6]
            ctr = rest[E[badm][:, 0]].mean(axis=0)
            info = f" pairs={top} at~{np.round(ctr, 2).tolist()}"
        LOG(f"  stretch pose {i}: {bad} bad edges{info}")
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    return worst
