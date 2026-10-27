"""CPU-only hand geometry export for r18 wrist-plane correction.
The final merge samples a tiny white/flat-normal cell in the existing 2048 atlas,
so both hands retain per-vertex skin/nail paint in the ONE character primitive.
No GPU bake, material, texture-size or rig/socket increase.
"""
import os,sys,json
import numpy as np
import bpy
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,HERE)
from lib import rig,skin,meshutil,pipeline,shaders,charkit
import build_boss_brutes as B
import build_boss_brute_forms as F
from build_enemy_ogre import rescale
ROOT=os.path.dirname(HERE);OUT=os.path.join(ROOT,'progress/shots/bosses/r18-brutes/hand-repair');os.makedirs(OUT,exist_ok=True)
meshutil.clear_scene();L=F.boss_landmarks();arm=rig.build_armature(L,'boss_brute',hair_chain=0,kilt_chain=0)
los=[];sculpts=[]
for side in ('L','R'):
    S=F.hand_sculpt(L,side);w=L['wrist_'+side]
    o=pipeline.lowpoly(S,'real_hand_'+side,.0016,5000,w-.60,w+.60,symmetry=False)
    F.clean_degenerate(o);o.data.validate()
    skin.skin(o,arm,method='sdf',allowed=['forearm_'+side,'hand_'+side],overrides=[(charkit.wrist_mask(L,side),'hand_'+side)],smooth=2)
    los.append(o);sculpts.append(S)
report={}
for bro in ('gor','mog'):
    verts=[];faces=[];colors=[];weights=[];offset=0;names=list(dict.fromkeys(g.name for o in los for g in o.vertex_groups))
    for o,S in zip(los,sculpts):
        shaders.assign_bake_materials(o,S.materials,prefix='hand_'+bro,kinds=B.BO.KINDS)
        shaders.paint_mesh(o,S.materials,L,B.bro_pal(bro),{},painters=B.PAINTERS)
        P=meshutil.get_verts(o,world=True);me=o.data;me.calc_loop_triangles()
        ls=np.empty(len(me.polygons),np.int32);me.polygons.foreach_get('loop_start',ls)
        lv=np.empty(len(me.loops),np.int32);me.loops.foreach_get('vertex_index',lv)
        C=np.empty((len(me.loops),4),np.float32);me.color_attributes['c_base'].data.foreach_get('color',C.ravel())
        verts.append(P);faces.append(lv[ls[:,None]+np.arange(3)]+offset);colors.append(C[ls[:,None]+np.arange(3)].reshape(-1,4));weights.append(skin.read_groups(o,names));offset+=len(P)
    out=meshutil.mesh_from_numpy('brute_hands_'+bro,np.concatenate(verts),tris=np.concatenate(faces))
    c=out.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER');c.data.foreach_set('color',np.concatenate(colors).ravel());out.data.color_attributes.active_color=c
    skin.write_groups(out,names,np.concatenate(weights));skin.bind(out,arm)
    mat=bpy.data.materials.new('hand_vertex_paint');mat.use_nodes=True;n=mat.node_tree.nodes.new('ShaderNodeVertexColor');n.layer_name='Col';bs=mat.node_tree.nodes.get('Principled BSDF');mat.node_tree.links.new(n.outputs['Color'],bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=.78;out.data.materials.append(mat)
    qa=skin.stretch_report(out,arm);report[bro]={'triangles':meshutil.tri_count(out),'qa':{k:v['bad'] for k,v in qa.items()}}
    K=B.BROS[bro]['K'];rescale(arm,[out],K);meshutil.select_only([arm,out],arm)
    enums=[e.identifier for e in bpy.ops.export_scene.gltf.get_rna_type().properties['export_vertex_color'].enum_items];vc='ACTIVE' if 'ACTIVE' in enums else 'MATERIAL'
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'hands_'+bro+'.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_skins=True,export_animations=False,export_texcoords=True,export_normals=True,export_tangents=False,export_materials='EXPORT',export_vertex_color=vc,export_armature_object_remove=True,export_influence_nb=4,export_all_influences=False,export_rest_position_armature=True)
    bpy.data.objects.remove(out,do_unlink=True);rescale(arm,[],1/K)
pipeline.write_json(os.path.join(OUT,'build-report.json'),report);print('HAND REPAIR',report)
