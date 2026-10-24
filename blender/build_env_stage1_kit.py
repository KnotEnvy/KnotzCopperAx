"""Ashen Wilds C2: layered burnt thatch, pitch rafters, wattle/daub, rubble foundations.
Only run through tools/blender-run.mjs. --fast makes a preview; one final release.
Blender Z-up, front -Y. One baked atlas + normal map, opaque vertex-tinted material.
COLOR_0 alpha carries ember weight, unpacked by stage1/kit.js (never opacity).
"""
import os, sys, math, random, json, struct
import bpy, bmesh, numpy as np
from mathutils import Vector
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,HERE)
from lib import pipeline
import stage1_straw
ROOT=os.path.dirname(HERE)
FAST='--fast' in sys.argv
OUT=os.path.join(ROOT,'public/assets/models/env_stage1_kit.glb')
META=os.path.join(ROOT,'public/assets/models/env_stage1_kit.json')
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(913)

def srgb(c):
    a=np.asarray(c,float); return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)

def atlas():
    """Cycles bake four procedural surface studies into a shared padded UV atlas."""
    pipeline.setup_cycles(samples=4 if FAST else 12)
    size=1024 if FAST else 2048
    color=bpy.data.images.new('Ashen_surface_bake',width=size,height=size,alpha=False)
    normal=bpy.data.images.new('Ashen_normal_bake',width=size,height=size,alpha=False); normal.colorspace_settings.name='Non-Color'
    planes=[]
    palettes=[((.20,.185,.15),(.62,.55,.41),(65,1.2,1)),((.045,.038,.034),(.22,.17,.12),(28,1.5,1)),((.23,.20,.17),(.64,.57,.45),(8,8,8)),((.25,.22,.17),(.62,.55,.43),(12,12,12))]
    for k,(c0,c1,stretch) in enumerate(palettes):
        bpy.ops.mesh.primitive_plane_add(size=2,location=(k*3,0,0)); ob=bpy.context.object; planes.append(ob)
        for uv in ob.data.uv_layers.active.data: uv.uv=(uv.uv.x*.5+(k%2)*.5,uv.uv.y*.5+(k//2)*.5)
        m=bpy.data.materials.new('bake_source_'+str(k)); m.use_nodes=True; ob.data.materials.append(m)
        n=m.node_tree.nodes; l=m.node_tree.links; n.clear()
        tc=n.new('ShaderNodeTexCoord'); scale=n.new('ShaderNodeVectorMath'); scale.operation='MULTIPLY'; scale.inputs[1].default_value=stretch; l.new(tc.outputs['Generated'],scale.inputs[0])
        noise=n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=3; noise.inputs['Detail'].default_value=3; noise.inputs['Roughness'].default_value=.72; l.new(scale.outputs['Vector'],noise.inputs['Vector'])
        if k==0:
            # Long, wandering fibres with fine raised reed ribs, baked once.
            wave=n.new('ShaderNodeTexWave'); wave.wave_type='BANDS'; wave.bands_direction='X'
            wave.inputs['Scale'].default_value=24; wave.inputs['Distortion'].default_value=6
            wave.inputs['Detail Scale'].default_value=.7; wave.inputs['Detail Roughness'].default_value=.8
            l.new(tc.outputs['Generated'],wave.inputs['Vector'])
            mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=.72
            l.new(noise.outputs['Fac'],mix.inputs[1]); l.new(wave.outputs['Color'],mix.inputs[2])
            fibre=mix.outputs[0]
        else:fibre=noise.outputs['Fac']
        ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position=.2; ramp.color_ramp.elements[1].position=.8
        ramp.color_ramp.elements[0].color=(*srgb(c0),1); ramp.color_ramp.elements[1].color=(*srgb(c1),1); l.new(fibre,ramp.inputs[0])
        if k==3:
            # Mineral variation, not a painted Voronoi crack on every stone.
            # Split faces come from the mesh; baked small-scale relief is subtle.
            mineral=n.new('ShaderNodeMixRGB');mineral.blend_type='MULTIPLY';mineral.inputs[0].default_value=.42
            l.new(ramp.outputs[0],mineral.inputs[1]);l.new(noise.outputs['Color'],mineral.inputs[2])
            stonecolor=mineral.outputs[0]
        bs=n.new('ShaderNodeBsdfPrincipled'); bs.inputs['Roughness'].default_value=.94; l.new(stonecolor if k==3 else ramp.outputs[0],bs.inputs['Base Color'])
        bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.55; bump.inputs['Distance'].default_value=.035 if k<2 else .018; l.new(fibre,bump.inputs['Height']); l.new(bump.outputs[0],bs.inputs['Normal'])
        em=n.new('ShaderNodeEmission'); l.new(stonecolor if k==3 else ramp.outputs[0],em.inputs[0]); out=n.new('ShaderNodeOutputMaterial'); l.new(em.outputs[0],out.inputs['Surface'])
        target=n.new('ShaderNodeTexImage'); target.image=color; n.active=target
        ob['bs']=bs.name; ob['out']=out.name; ob['target']=target.name
    bpy.ops.object.select_all(action='DESELECT')
    for ob in planes: ob.select_set(True)
    bpy.context.view_layer.objects.active=planes[0]; bpy.context.scene.render.bake.use_clear=False; bpy.context.scene.render.bake.margin=8
    bpy.ops.object.bake(type='EMIT')
    for ob in planes:
        m=ob.data.materials[0]; n=m.node_tree.nodes; m.node_tree.links.new(n[ob['bs']].outputs[0],n[ob['out']].inputs['Surface']); n[ob['target']].image=normal
    bpy.ops.object.bake(type='NORMAL')
    # Bake actual carved stone relief (selected high surface -> low atlas plane),
    # including cavity AO. Release gives this quadrant 1024px, not a blurry
    # low-resolution noise patch; broad face splits remain in the rock meshes.
    low=planes[3];resolution=128 if FAST else 192
    vertices=[];faces=[]
    for j in range(resolution+1):
        y=-1+2*j/resolution
        for i in range(resolution+1):
            x=-1+2*i/resolution
            seam=min(abs(y-.21*x-.14),abs(y+.75*x+.48),abs(x-.38-.10*math.sin(y*4)))
            groove=.032*math.exp(-(seam/.014)**2)
            grain=.004*math.sin(x*71+math.sin(y*31)) * math.sin(y*83-x*19)
            flake=.009*math.sin(x*12+y*7)*math.sin(y*16-x*5)
            vertices.append((x+9,y,.055+grain+flake-groove))
    for j in range(resolution):
        for i in range(resolution):
            a=j*(resolution+1)+i;faces.append((a,a+1,a+resolution+2,a+resolution+1))
    me=bpy.data.meshes.new('stone_relief_sculpt');me.from_pydata(vertices,[],faces);me.update()
    high=bpy.data.objects.new('stone_relief_bake_source',me);bpy.context.collection.objects.link(high)
    sm=bpy.data.materials.new('stone_relief_source');sm.use_nodes=True;high.data.materials.append(sm)
    for poly in me.polygons:poly.use_smooth=True
    bpy.ops.object.select_all(action='DESELECT');low.select_set(True);high.select_set(True)
    bpy.context.view_layer.objects.active=low
    bake=bpy.context.scene.render.bake;bake.use_selected_to_active=True;bake.cage_extrusion=.15;bake.max_ray_distance=.2
    target=low.data.materials[0].node_tree.nodes[low['target']]
    target.image=normal;bpy.ops.object.bake(type='NORMAL')
    ao=bpy.data.images.new('Ashen_stone_cavity_AO',width=size,height=size,alpha=False)
    ao.colorspace_settings.name='Non-Color';target.image=ao
    bpy.context.scene.world.color=(1,1,1)
    bpy.context.scene.cycles.samples=8 if FAST else 32
    bpy.ops.object.bake(type='AO')
    cp=np.asarray(color.pixels[:],np.float32).reshape(size,size,4)
    ap=np.asarray(ao.pixels[:],np.float32).reshape(size,size,4)
    ap=(ap*4+np.roll(ap,1,0)+np.roll(ap,-1,0)+np.roll(ap,1,1)+np.roll(ap,-1,1))/8
    # Only stone's upper-right quadrant was targeted; never darken other tiles.
    sl=(slice(size//2,size),slice(size//2,size))
    cp[sl][:,:,:3]*=(.35+.65*np.clip(ap[sl][:,:,:3],0,1))
    color.pixels.foreach_set(cp.ravel());color.update()
    bake.use_selected_to_active=False;bpy.data.objects.remove(high,do_unlink=True)
    bpy.data.images.remove(ao)
    for im in (color,normal): im.pack()
    for ob in planes:bpy.data.objects.remove(ob,do_unlink=True)
    mat=bpy.data.materials.new('Ashen_baked_thatch_daub_char_stone'); mat.use_nodes=True
    n=mat.node_tree.nodes; l=mat.node_tree.links; bs=n.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.95
    tx=n.new('ShaderNodeTexImage'); tx.image=color; l.new(tx.outputs['Color'],bs.inputs['Base Color'])
    nt=n.new('ShaderNodeTexImage'); nt.image=normal; nm=n.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.55; l.new(nt.outputs['Color'],nm.inputs['Color']); l.new(nm.outputs[0],bs.inputs['Normal'])
    return mat

MAT=atlas()
STRAW=stage1_straw.material()
class Build:
    def __init__(self,name):self.name=name;self.v=[];self.f=[];self.uv=[];self.c=[];self.s=[]
    def face(self,pts,tile=0,uv=None,col=(1,1,1),ember=0,smooth=False):
        start=len(self.v); self.v.extend(pts); self.f.append(tuple(range(start,start+len(pts))));self.s.append(smooth)
        uv=uv or [(0,0),(1,0),(1,1),(0,1)][:len(pts)]
        for i,p in enumerate(pts):
            u,v=uv[i]; self.uv.append((u,v) if tile<0 else ((tile%2)*.5+.012+max(0,min(.999,u))*.476,(tile//2)*.5+.012+max(0,min(.999,v))*.476))
            cc=col[i] if isinstance(col,list) else col; ee=ember[i] if isinstance(ember,list) else ember
            self.c.append((*cc,ee))
    def box(self,c,h,tile=1,col=(1,1,1)):
        x,y,z=c; a,b,d=h
        v=[(x+i*a,y+j*b,z+k*d) for i,j,k in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:self.face([v[i] for i in f],tile,col=col)
    def masonry(self,c,h,tint,rng):
        # Chamfered chipped corners and uneven planes preserve a block silhouette.
        x,y,z=c;a,b,d=h;q=.035
        rings=[]
        for zz,inset in [(-d,q),(-d+q,0),(d-q,0),(d,q)]:
            aa,bb=a-inset,b-inset
            xy=[(-aa+q,-bb),(aa-q,-bb),(aa,-bb+q),(aa,bb-q),(aa-q,bb),(-aa+q,bb),(-aa,bb-q),(-aa,-bb+q)]
            rings.append([(x+u+rng.uniform(-.012,.012),y+v+rng.uniform(-.012,.012),z+zz+rng.uniform(-.012,.012)) for u,v in xy])
        for j in range(3):
            for i in range(8):
                k=(i+1)%8;v=tint*rng.uniform(.86,1.04)
                self.face([rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]],3,col=(v*.91,v*.95,v))
        for ring in [rings[0][::-1],rings[-1]]:
            self.face(ring,3,[(.5+p[0]-x,.5+p[1]-y) for p in ring],col=(tint,tint*.98,tint*.94))
    def beam(self,a,b,r=.09,tile=1,col=(1,1,1),ember=0):
        a,b=Vector(a),Vector(b); axis=(b-a).normalized(); side=axis.cross(Vector((0,0,1)))
        if side.length<.01:side=axis.cross(Vector((0,1,0)))
        side.normalize(); up=axis.cross(side); rings=[]; sides=3 if r<.02 else 6
        ts=[0,1] if r<.03 else [0,.48,1]
        for t in ts:
            rr=r*(1-.18*t); rings.append([a.lerp(b,t)+side*(math.cos(i*math.tau/sides)*rr)+up*(math.sin(i*math.tau/sides)*rr) for i in range(sides)])
        for j in range(len(ts)-1):
            for i in range(sides):
                k=(i+1)%sides;self.face([rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]],tile,[(i/sides,.02),(k/sides,.02),(k/sides,.98),(i/sides,.98)],col,ember)
        self.face(list(reversed(rings[0])),tile,[(i/sides,.1) for i in range(sides)],col,ember)
        self.face(rings[-1],tile,[(i/sides,.8) for i in range(sides)],col,ember)
    def broken(self,a,b,r,rng):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized()
        side=axis.cross(Vector((1,0,0))).normalized();up=axis.cross(side)
        root=[];end=[]
        for i in range(6):
            v=side*math.cos(i*math.tau/6)+up*math.sin(i*math.tau/6)
            root.append(a+v*r)
            end.append(b+v*r*rng.uniform(.55,.95)+axis*rng.uniform(-.10,.045))
        for i in range(6):
            k=(i+1)%6
            self.face([root[i],root[k],end[k],end[i]],1,col=(.55 if i%3==0 else .33,.40 if i%3==0 else .27,.25 if i%3==0 else .19))
        centre=sum(end,Vector())/6-axis*.035
        for i in range(6):
            self.face([end[i],end[(i+1)%6],centre],1,[(.1,.1),(.9,.1),(.5,.8)],
                      col=(.10,.075,.05),ember=.035 if i%3==0 else .003)

    def stone(self,verts,faces,c,scale):
        for f in faces:
            angle=math.sin(float(c[0])*31+float(c[1])*13)*.75 if scale[0]<.6 else 0
            cs,sn=math.cos(angle),math.sin(angle)
            pp=[]
            for i in f:
                px,py,pz=np.asarray(verts[i])*scale
                pp.append(tuple(np.array((px*cs-py*sn,px*sn+py*cs,pz))+c))
            # Baked vertex occlusion/moss live low in the footing; soot climbs
            # into the wall. Broad split planes keep their own hard normals.
            tone=.88+.24*math.sin(float(c[0])*9+float(c[1])*13+float(c[2])*17)
            cols=[]
            for j,i in enumerate(f):
                crown=max(0,min(1,(verts[i][2]+.05)*1.3))
                foundation=scale[0]<.9
                height=pp[j][2]
                contact=.45+.55*max(0,min(1,(height+.02)/.20)) if foundation else .65+.35*crown
                soot=1-.35*max(0,min(1,(height-.36)/.45)) if foundation else 1
                moss=max(0,1-abs(height-.12)/.19)*(.45+.55*max(0,math.sin(pp[j][0]*12+pp[j][1]*9))) if foundation else 0
                mineral=np.array((.98,.92,.80))*tone*contact*soot
                # Small fresh split planes, broad mineral faces, dark bedding.
                if len(f)<=4 and crown>.3:mineral*=1.22
                green=np.array((.23,.31,.075))*contact
                cols.append(tuple(mineral*(1-moss*.72)+green*moss*.72))
            n=(Vector(pp[1])-Vector(pp[0])).cross(Vector(pp[2])-Vector(pp[0]))
            axis=max(range(3),key=lambda k:abs(n[k]))
            uvaxes=[(1,2),(0,2),(0,1)][axis]
            # Rotate and offset within the padded quadrant per stone, not per face.
            phase=float(c[0])*17+float(c[1])*11+float(scale[2])*31
            ca,sa=math.cos(phase),math.sin(phase)
            uv=[]
            for i in f:
                u,v=verts[i][uvaxes[0]],verts[i][uvaxes[1]]
                uv.append((.5+(u*ca-v*sa)*.18+math.sin(phase*3)*.12,
                           .5+(u*sa+v*ca)*.18+math.cos(phase*2)*.12))
            self.face(pp,3,uv,col=cols,smooth=False)
    def finish(self,material=None):
        me=bpy.data.meshes.new(self.name);me.from_pydata(self.v,[],self.f);me.update()
        ob=bpy.data.objects.new(self.name,me);bpy.context.collection.objects.link(ob);me.materials.append(material or MAT)
        uv=me.uv_layers.new(name='UVMap'); ca=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
        ca.data.foreach_set('color',np.asarray([self.c[loop.vertex_index] for loop in me.loops],dtype=np.float32).ravel()); me.color_attributes.active_color=ca
        for p in me.polygons:
            p.use_smooth=self.s[p.index]
            for li in p.loop_indices:uv.data[li].uv=self.uv[me.loops[li].vertex_index]
        # Recalculate consistent manifold fragment normals before export.
        bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00005);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
        return ob

# Three distinct split fieldstones: squat wedge, long bedding slab, upright
# fractured block. Convex broad planes with chipped corners, no smooth loaves.
rockdata=[]; objects=[]
for k in range(3):
    rng=random.Random(901+k*37)
    profile=[(1.0,.76,1.05),(1.26,.68,.65),(.62,.72,1.48)][k]
    bm=bmesh.new()
    for z in [-.62,.65]:
        for x,y in [(-1,-.63),(-.55,-1),(.65,-.94),(1,-.35),(.86,.75),(.10,1),(-.88,.70)]:
            taper=1 if z<0 else [.80,.98,.63][k]
            px=(x*taper+rng.uniform(-.13,.13))*profile[0]
            py=(y*taper+rng.uniform(-.12,.12))*profile[1]
            pz=(z+.10*x+(.16*y if k==0 else 0)+rng.uniform(-.10,.10))*profile[2]+.17
            bm.verts.new((px,py,pz))
    hull=bmesh.ops.convex_hull(bm,input=list(bm.verts))
    bmesh.ops.delete(bm,geom=hull.get('geom_interior',[]),context='VERTS')
    bmesh.ops.bevel(bm,geom=list(bm.edges),offset=.055,segments=2,affect='EDGES')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.verts.ensure_lookup_table();bm.verts.index_update()
    vv=[tuple(v.co) for v in bm.verts];ff=[tuple(v.index for v in f.verts) for f in bm.faces]
    rockdata.append((vv,ff));bm.free()
    B=Build('stone_'+str(k));B.stone(vv,ff,np.zeros(3),np.ones(3));objects.append(B.finish())

specs=[(19,5.2,3.9,2.5,.5,None,False),(3,5.6,4,2.5,.75,1,False),(5,5.4,3.9,2.5,0,None,True),(7,6,4.2,2.8,1,-.6,False),(11,5.2,3.9,2.5,.35,1.2,False),(13,5.8,3.9,2.5,.8,None,False),(17,5.4,3.9,2.5,0,None,True)]
meta={'version':2,'revision':'C2-r15-collapsed-recesses-warm-stone','fast':FAST,'stoneBake':{'normal':'selected-to-active carved relief','ao':'Cycles cavity AO multiplied into albedo','atlasSize':1024 if FAST else 2048},'huts':{}}
for seed,w,d,rise,collapse,hu,gutted in specs:
    rng=random.Random(seed);B=Build('hut_'+str(seed));C=Build('straw_'+str(seed)); wall=2.05;H=wall+rise;hx=w/2;hz=d/2;hu=hu if hu is not None else hx*.4
    # Hand-laid mixed footing: large sunk blocks, slabs bridging gaps, small
    # wedging chips. Heights and spacing do not repeat in two tidy rows.
    for side in [-1,1]:
        x=-hx+.15;stone_index=0
        while x<hx:
            kind=(stone_index+seed)%3;size=[.40,.33,.34][kind]*rng.uniform(.82,1.18)
            extent=size*[1,1.36,.72][kind]
            if not(side==-1 and abs(x)<.63):
                rv,rf=rockdata[kind]
                B.stone(rv,rf,np.array((x,side*hz+rng.uniform(-.12,.10),.20+rng.uniform(-.035,.035))),np.array((size,size*rng.uniform(.75,1.0),size)))
                if rng.random()<.35:
                    rv,rf=rockdata[1 if kind!=1 else 0]
                    B.stone(rv,rf,np.array((x+rng.uniform(-.15,.12),side*hz+rng.uniform(-.04,.09),.43+rng.uniform(-.04,.07))),np.array((rng.uniform(.18,.28),.23,rng.uniform(.17,.26))))
                if rng.random()<.55:
                    rv,rf=rockdata[2]
                    B.stone(rv,rf,np.array((x+extent*.85,side*(hz+.11),.055)),np.array((.11,.14,.13)))
            x+=extent*1.95+rng.uniform(.08,.20);stone_index+=1
    for x in [-hx,hx]:
        for i,z in enumerate(np.arange(-hz+.25,hz,.65)):
            rv,rf=rockdata[i%3];B.stone(rv,rf,np.array((x,z,.20)),np.array((.30,.34,.35)))
    # Frame follows roof pitch. Broken front-right posts on gutted variants.
    for x in [-hx,-w/6,w/6,hx]:
        for y in [-hz,hz]:
            rv,rf=rockdata[2]
            B.stone(rv,rf,np.array((x,y,.16)),np.array((.37,.35,.32)))
            B.beam((x,y,.38),(x+rng.uniform(-.06,.06),y,wall if not gutted else rng.uniform(.7,wall)),.115)
    for y in [-hz,hz]:B.beam((-hx-.2,y,wall),(hx+.2,y,wall),.115)
    for x in [-hx,hx]:
        B.beam((x,-hz,wall),(x,0,H),.10);B.beam((x,0,H),(x,hz,wall),.10)
        B.beam((x,-hz,.5),(x,-.3,wall),.07)
    B.beam((-hx-.4,0,H),(hx+.4,0,H-.12),.115)
    for x in np.arange(-hx+.25,hx,.63):
        for side in [-1,1]:
            if gutted and rng.random()<.45:continue
            start=Vector((x,0,H-.08));end=Vector((x,side*(hz+.45),wall-.16))
            if seed==7 and side==-1:
                end.z-=.5*max(0,1-abs(x+.5)/2.6)
                start.z-=.35*max(0,1-abs(x+.5)/2.6)
            burnt=side==-1 and abs(x-hu)<1.0+collapse*1.25
            if burnt:
                # Consumed sections expose glowing ragged end grain. Separate
                # upper/lower remnants leave depth and negative space inside.
                a=start.lerp(end,rng.uniform(.22,.40));b=start.lerp(end,rng.uniform(.68,.87))
                B.broken(start,a,.105,rng)
                B.broken(end,b,.092,rng)
            else:B.beam(start,end,.095,col=(.48,.50,.49))
    for side in [-1,1]:
        for t in [.32,.68]:
            y=side*(hz+.45)*t;z=H-(rise+.16)*t
            if side==-1:
                B.beam((-hx,y,z),(hu-.35,y,z-.04),.085,col=(.40,.43,.45))
                B.beam((hu+.20,y,z-.08),(hx,y,z),.075,col=(.30,.33,.35))
            else:B.beam((-hx,y,z),(hx,y,z),.075,col=(.55,.51,.43))
    # Recessed diagonal charred inner bracing catches uneven fire spill. It is
    # behind the aperture, not an opaque plane filling its silhouette.
    if not gutted:
        for j in range(4):
            a=Vector((hu-1.25+j*.55,hz*.40,wall+.16));b=Vector((hu-.85+j*.55,hz*.04,H-.55))
            B.beam(a,b,.065,col=(.32,.35,.37))
    if not gutted:
        for x in np.arange(-hx+.18,hx,.52):
            if seed==7 and x<-.7:continue
            B.beam((x,.12,H-.19),(x,hz-.06,wall+.08),.075,col=(.55,.50,.43))
    # Daub has irregular missing patches, with woven rods underneath.
    for side in [-1,1]:
        for bay in range(3):
            x0=-hx+bay*w/3; x1=x0+w/3
            if side==-1 and bay==1:continue
            if not gutted:
                top=wall-.1 if not (side==-1 and bay==2) else 1.25
                # Crumbled top contour rather than a ruler-straight panel.
                pts=[(x0+.1,side*(hz-.025),.4),(x1-.1,side*(hz-.025),.4),(x1-.1,side*(hz-.025),top-.14),(x1-.48,side*(hz-.025),top+.04),((x0+x1)/2,side*(hz-.025),top-.07),(x0+.1,side*(hz-.025),top)]
                B.face(pts,2,[(0,.02),(.98,.02),(.98,.95),(.75,.98),(.5,.9),(.02,.98)],col=[(.96,.94,.9),(.95,.92,.88),(.32,.30,.29),(.42,.39,.36),(.57,.53,.48),(.72,.67,.59)])
            if side==-1 and seed in (11,13):
                for i,x in enumerate(np.arange(x0+.15,x1-.08,.23)):
                    top=wall-rng.uniform(.05,.48)
                    B.box((x,-hz-.045,(top+.42)/2),(.095,.065,(top-.42)/2),1,
                          col=(.65+i%3*.11,.64+i%3*.10,.58+i%3*.08))
                if bay==2:B.beam((x0+.1,-hz-.14,.72),(x1-.1,-hz-.14,1.65),.065,col=(.8,.78,.68))
            elif side==-1:
                for z in np.arange(.65,wall-.1,.13):
                    if bay==0 and not gutted and z<1.72:continue
                    B.beam((x0+.1,-hz-.03,z),(x1-.1,-hz-.045,z+rng.uniform(-.035,.035)),.021,col=(1.5,1.35,1.1))
                for x in np.arange(x0+.18,x1,.27):B.beam((x,-hz-.055,.5),(x,-hz-.06,wall-.1),.025)
    if not gutted:
        for x in [-hx,hx]:
            B.box((x,0,1.2),(.055,hz-.1,.8),2,col=(.75,.71,.64))
            B.face([(x,-hz,wall),(x,hz,wall),(x,0,H-.15)],2,[(.01,.01),(.99,.01),(.5,.99)],(.55,.52,.47))
        # Crooked door planks, a dark recess visible between them.
        B.box((0,hz-.2,1.1),(hx-.1,.05,1),1,col=(.2,.24,.3))
        if seed in (3,19):
            # One skewed half-door; the second half has fallen onto the sill.
            for i in range(3):
                B.box((-.52+i*.20,-hz-.10,1.04),(.085,.07,.68-i*.06),1,col=(.72,.75,.72))
            B.beam((-.7,-hz-.18,.75),(-.04,-hz-.18,.68),.045,col=(.8,.8,.73))
        elif seed==7:
            for i in range(4):B.box((-.4+i*.23,-hz-.72,.085+i*.012),(.10,.66,.055),1,col=(.6,.63,.60))
        # 11/13 have an entirely open doorway and an offset warm recess.
        elif seed==11:B.box((.58,-hz-.75,.11),(.24,.65,.07),1,col=(.75,.72,.62))
    if seed in (3,7,13):
        # Smoke-blackened stone chimney, deliberately off-centre in the roof mass.
        B.box((-hx+.42,.45,3.85),(.24,.24,1.95),3,col=(.24,.25,.25))
        # Interlocked, nearly rectangular masonry: no broad disc-like courses.
        for row in range(11):
            z=2.0+row*.34
            for j in range(2):
                offset=(j-.5)*.33
                c=(-hx+.42+(offset if row%2 else 0),.45+(0 if row%2 else offset),z+rng.uniform(-.035,.035))
                half=(.15,.31,.16) if row%2 else (.31,.15,.16)
                # Chipped box corners give block silhouettes, varied ash tint.
                tint=rng.uniform(.48,.82)
                B.masonry(c,tuple(v*rng.uniform(.90,1.08) for v in half),tint,rng)
    rim=[]
    for side in [-1,1]:
        if gutted:continue
        slope=math.hypot(rise+.28,hz+.55);D=Vector((0,side*(hz+.55)/slope,-(rise+.28)/slope));N=Vector((0,side*(rise+.28)/slope,(hz+.55)/slope))
        def hole(u,v):
            if side==1:
                if seed==7:return 1+(u+.7)+.12*math.sin(v*11+u*7)
                return 99
            # Distinct destruction histories, not one oval scaled seven times.
            rag=.08*math.sin(u*9+v*7+seed)+.045*math.sin(u*19-v*11)
            if seed==11:
                # Left: angular triangular collapse. Right: skewed split with
                # a deep downward notch; different silhouettes at game camera.
                ax=(u+1.15)/.70;ay=(v-.36*slope)/.62
                a=max(abs(ax)*.85-ay*.30,ay*.92,-ay*.95)+rag*1.7
                bx=(u-1.04)/.88;by=(v-.61*slope)/.67
                b=max(abs(bx+by*.35),abs(by))+.15*math.sin(v*5+u*3)
                split=max(abs(u-1.34)/.22,(.71*slope-v)/.56+1)
                return min(a,b,split)+rag
            if seed==7:
                # Much of the right pitch has fallen; ragged diagonal loss from
                # ridge to eave exposes sagging rafters rather than an aperture.
                return 1+(abs(u+.30)-1.35-.30*v-.20*math.sin(v*2.7))+.10*math.sin(u*16-v*9)
            du=(u-hu)/(1+collapse*.95);dv=(v-.45*slope)/(.65+collapse*.62)
            main=max(abs(du+dv*.17),abs(dv)*.93)+rag*1.6+.13*math.sin(v*4+seed)
            notch=max(abs(u-hu-.2*math.sin(v*3))/.27,(.58*slope-v)/.48+1)+rag
            return min(main,notch) if seed in (3,13) else main
        def sag(u,v):
            return .52*max(0,1-abs(u+.5)/2.8)*math.sin(min(1,v/slope)*math.pi*.8) if seed==7 and side==-1 else .10*math.sin(u*1.45+seed)*math.sin(min(1,v/slope)*math.pi)
        def clamp(x):return max(0,min(1,x))
        def paint(u,v):
            h=hole(u,v)
            # Carbon directly tints each straw card over 2-3 adjacent courses.
            # No brown intermediate halo: weathered reed -> grey ash -> black.
            burn=clamp((1.27-h+.045*math.sin(u*23-v*17))/.21)
            soot=0
            if side==-1:
                soot=math.exp(-((u-hu)/(1.0+collapse*.75))**2)*clamp((slope*.46-v)/.75)*(.54+.30*math.sin(u*13+v*.7)**2)
            patch=.5+.5*math.sin(u*2.6+v*.9+seed)*math.sin(v*3.1-u)
            weather=clamp(v/slope*.75+patch*.40)
            straw=np.array((.90,.77,.59))*(1-weather)+np.array((.52,.60,.65))*weather
            straw*=.63+.42*patch
            straw*=1-soot*.38
            char=np.array((.045,.052,.057))*(.72+.48*abs(math.sin(u*31-v*17)))
            return tuple(straw*(1-burn)+char*burn)
        stage1_straw.roof(B,C,rng,hx,H,slope,D,N,hole,paint,rim,side,sag)
    if C.f:objects.append(C.finish(STRAW))
    # Broken timbers spill outward, do not obstruct the combat lane.
    for i in range(5):
        x=rng.uniform(-hx,hx);B.beam((x,-hz-.5,.14),(x+rng.uniform(-1,1),-hz-rng.uniform(.7,1.6),rng.uniform(.06,.35)),.06)
    if gutted:rim=[(0,-hz*.35,H*.55),(-hx*.4,-hz*.6,1.2),(hx*.5,-hz,.45)]
    objects.append(B.finish())
    # Deterministic spread along the actual burnt edges, in glTF Y-up coordinates.
    pts=sorted(rim,key=lambda p:math.atan2(p[2]-H*.65,p[0]-hu))
    count=3 if gutted else 6
    anchors=[pts[int((i+.5)*len(pts)/count)%len(pts)] for i in range(count)] if pts else []
    smoke=[(-1.15,.36),(1.1,.64)] if seed==11 else [(hu,.48)]
    meta['huts'][str(seed)]={'flames':[[p[0],p[2],-p[1]] for p in anchors],
      'smoke':[[x,H-(rise+.28)*t,(hz+.55)*t] for x,t in smoke],
      'door':'half-door' if seed in (3,19) else 'fallen' if seed==7 else 'open',
      'walls':'plank' if seed in (11,13) else 'wattle',
      'damage':'frame' if gutted else 'collapsed-pitch' if seed==7 else 'two-apertures' if seed==11 else 'ragged-aperture'}

bpy.ops.object.select_all(action='DESELECT')
for ob in objects:ob.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=OUT+'.tmp.glb',export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_materials='EXPORT',export_image_format='AUTO',export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_extras=False)
meta['triangles']={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects}
with open(META+'.tmp','w') as f:json.dump(meta,f,indent=2)
# Blender 5's dithered surface exports BLEND; this game asset is a strict MASK.
# Repack only the JSON chunk, leaving the embedded textures/buffers byte-identical.
with open(OUT+'.tmp.glb','rb') as f:glb=f.read()
json_size=struct.unpack_from('<I',glb,12)[0];doc=json.loads(glb[20:20+json_size])
for material in doc['materials']:
    if material['name']=='Ashen_alpha_straw':
        material['alphaMode']='MASK';material['alphaCutoff']=.45;material['doubleSided']=True
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
rest=glb[20+json_size:]
with open(OUT+'.tmp.glb','wb') as f:f.write(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(rest))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+rest)
os.replace(OUT+'.tmp.glb',OUT)
os.replace(META+'.tmp',META)
print('STAGE1_KIT',json.dumps(meta),flush=True)
