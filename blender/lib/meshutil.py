"""Blender-side mesh helpers: numpy <-> bpy meshes, attributes, decimation, cleanup."""
import numpy as np
import bpy
import bmesh


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.objects,
                 bpy.data.curves, bpy.data.node_groups):
        for b in list(coll):
            try:
                coll.remove(b)
            except Exception:
                pass
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0


def mesh_from_numpy(name, verts, quads=None, tris=None, collection=None, smooth=True):
    verts = np.asarray(verts, np.float32)
    faces_loops, starts = [], []
    total = 0
    parts = []
    if quads is not None and len(quads):
        q = np.asarray(quads, np.int64)
        parts.append(q.reshape(-1))
        starts.append(np.arange(len(q)) * 4)
        total += len(q) * 4
    if tris is not None and len(tris):
        t = np.asarray(tris, np.int64)
        parts.append(t.reshape(-1))
        base = total
        starts.append(base + np.arange(len(t)) * 3)
        total += len(t) * 3
    loops = np.concatenate(parts).astype(np.int32)
    loop_start = np.concatenate(starts).astype(np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(len(loops))
    me.loops.foreach_set("vertex_index", loops)
    me.polygons.add(len(loop_start))
    me.polygons.foreach_set("loop_start", loop_start)
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def get_verts(ob, world=False):
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    if world:
        M = np.array(ob.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
    return co


def set_verts(ob, co):
    ob.data.vertices.foreach_set("co", np.asarray(co, np.float32).ravel())
    ob.data.update()


def get_normals(ob):
    me = ob.data
    n = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("normal", n)
    return n.reshape(-1, 3).astype(np.float64)


def add_float_attr(ob, name, values, domain="POINT"):
    me = ob.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, "FLOAT", domain)
    a.data.foreach_set("value", np.asarray(values, np.float32))
    return a


def add_color_attr(ob, name, rgba, domain="POINT"):
    me = ob.data
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    a = me.color_attributes.new(name, "FLOAT_COLOR", domain)
    rgba = np.asarray(rgba, np.float32)
    if rgba.shape[1] == 3:
        rgba = np.concatenate([rgba, np.ones((len(rgba), 1), np.float32)], axis=1)
    a.data.foreach_set("color", rgba.ravel())
    return a


def tri_count(ob):
    me = ob.data
    n = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", n)
    return int((n - 2).sum())


def select_only(obs, active=None):
    bpy.context.view_layer.update()
    for o in list(bpy.context.view_layer.objects):
        if o is not None:
            o.select_set(False)
    for o in obs:
        if o is not None:
            o.select_set(True)
    bpy.context.view_layer.objects.active = active or (obs[0] if obs else None)


def apply_modifiers(ob):
    select_only([ob])
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def decimate(ob, target_tris, vgroup=None, vg_factor=1.0, symmetry=True):
    cur = tri_count(ob)
    if cur <= target_tris:
        return ob
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = max(0.0005, target_tris / cur)
    m.use_collapse_triangulate = True
    if symmetry:
        m.use_symmetry = True
        m.symmetry_axis = "X"
    if vgroup:
        m.vertex_group = vgroup
        m.vertex_group_factor = vg_factor
        m.invert_vertex_group = True
    apply_modifiers(ob)
    return ob


def triangulate(ob):
    m = ob.modifiers.new("tri", "TRIANGULATE")
    m.quad_method = "BEAUTY"
    m.ngon_method = "BEAUTY"
    apply_modifiers(ob)


def join(obs, name):
    select_only(obs, obs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def duplicate(ob, name):
    ob2 = ob.copy()
    ob2.data = ob.data.copy()
    ob2.name = name
    ob2.data.name = name
    for c in ob.users_collection:
        c.objects.link(ob2)
    return ob2


def vertex_group_from_weights(ob, name, w):
    vg = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    w = np.asarray(w, float)
    idx = np.nonzero(w > 1e-4)[0]
    # group by rounded weight for speed
    ws = np.round(w[idx], 3)
    for val in np.unique(ws):
        sel = idx[ws == val].tolist()
        vg.add(sel, float(val), "REPLACE")
    return vg


def smooth_verts(ob, iters=2, factor=0.5, vgroup=None):
    m = ob.modifiers.new("sm", "SMOOTH")
    m.iterations = iters
    m.factor = factor
    if vgroup:
        m.vertex_group = vgroup
    apply_modifiers(ob)


def mesh_to_numpy(ob):
    """(verts Nx3, tris Mx3) of an evaluated, triangulated copy."""
    dg = bpy.context.evaluated_depsgraph_get()
    oe = ob.evaluated_get(dg)
    me = oe.to_mesh()
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", v)
    t = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", t)
    oe.to_mesh_clear()
    return v.reshape(-1, 3), t.reshape(-1, 3)


def bm_to_object(bm, name, collection=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob
