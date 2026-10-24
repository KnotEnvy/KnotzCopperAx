"""Brann's instanced basalt family. Geometry, bevel lips and recessed hot fracture faces.
Run only through tools/blender-run.mjs. --preview is accepted; deterministic release topology is identical.
Three small GLBs, no textures, lights or external assets. Vertex alpha carries the fracture heat mask.
"""
import bpy
import math
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build(variant):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    rng = random.Random(307 + variant * 193)
    verts, faces, colors, heats = [], [], [], []

    def prism(cx, cy, lo, hi, radius, phase, slope, hot=False):
        # Chamfered hexagonal blocks, with substantial split depth between the blocks.
        start = len(verts)
        rings = [(lo, .87), (lo + .012, 1), (hi - .018, .96), (hi, .79)]
        tint = rng.uniform(.60, .88)
        for j, (z, scale) in enumerate(rings):
            for k in range(6):
                a = phase + k * math.tau / 6
                x, y = math.cos(a) * radius * scale, math.sin(a) * radius * scale
                verts.append((cx + x, cy + y, z + (slope[0] * x + slope[1] * y) * (j / 3)))
        def face(ids, lip=False):
            faces.append(tuple(start + i for i in ids))
            if hot:
                colors.append((.22, .065, .012, 1)); heats.append(1)
            elif lip:
                colors.append((tint * 1.06, tint * .79, tint * .55, 1)); heats.append(.012)
            else:
                colors.append((tint * .83, tint * .87, tint * .90, 1)); heats.append(0)
        face(list(reversed(range(6))), True)
        for j in range(3):
            for k in range(6):
                face([j * 6 + k, j * 6 + (k + 1) % 6, (j + 1) * 6 + (k + 1) % 6, (j + 1) * 6 + k], j != 1)
        face([18 + i for i in range(6)], True)

    for rod in range(7):
        a = rod * math.tau / 6 + variant * .37
        d = 0 if rod == 6 else rng.uniform(.30, .37)
        cx, cy = math.cos(a) * d, math.sin(a) * d
        radius = rng.uniform(.185, .238) if rod != 6 else .245
        height = [rng.uniform(.48, .94), rng.uniform(.63, .96), rng.uniform(.37, .88)][variant]
        if rod == variant * 2: height = 1
        cuts = [0, height * rng.uniform(.27, .40), height * rng.uniform(.61, .76), height]
        slope = (rng.uniform(-.32, .32), rng.uniform(-.38, .38))
        phase = a + rng.uniform(-.13, .13)
        for j in range(3):
            lo = cuts[j] + (0 if j == 0 else .012)
            hi = cuts[j + 1] - (.012 if j < 2 else 0)
            prism(cx + j * .009 * math.cos(a), cy + j * .009 * math.sin(a), lo, hi,
                  radius * (1 - j * .055), phase, slope)
            if j < 2:
                # Recess the glowing core behind the bevel and both broken lips.
                prism(cx, cy, hi - .01, cuts[j + 1] + .02, radius * .72, phase, slope, True)
        # Inner molten joint visible through the narrow *vertical* gaps between basalt rods.
    prism(0, 0, .04, .73, .18, 0, (0, 0), True)
    mesh = bpy.data.meshes.new('basalt_fracture_mesh')
    mesh.from_pydata(verts, [], faces); mesh.update()
    col = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    uv = mesh.uv_layers.new(name='UVMap')
    heat_uv = mesh.uv_layers.new(name='HeatUV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            col.data[li].color = (*colors[p.index][:3], heats[p.index])
            v = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (v.x * 2 + v.y, v.z * 2)
            heat_uv.data[li].uv = (heats[p.index], 0)
    obj = bpy.data.objects.new('basalt_%d' % variant, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    mat = bpy.data.materials.new('basalt_vertex_heat'); mat.diffuse_color = (.4, .4, .4, 1)
    mat.use_nodes = True
    vc = mat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    obj.data.materials.append(mat)
    out = os.path.join(ROOT, 'public/assets/models/magic_basalt%d.glb' % variant)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
        export_yup=True, export_normals=True, export_texcoords=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT')
    print('BASALT', variant, 'tris', sum(len(p.vertices) - 2 for p in mesh.polygons), 'bytes', os.path.getsize(out))


for variant in range(3):
    build(variant)
