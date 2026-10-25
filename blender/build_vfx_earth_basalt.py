"""C2 r14: heavy prismatic basalt, interrupted recessed faults and an articulated stone titan fist.
ONLY run via tools/blender-run.mjs. Preview/release have identical game topology.
A displaced subdivision sculpt is baked to the game mesh: tangent normal + AO/cavity.
UV1 = signed heat (negative = fresh break)/bounce, UV2/3 = rigid fracture pivot/id; UV0 = shared six-asset bake atlas.
"""
import bpy, math, os, sys, random, shutil, json
import numpy as np
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'blender'))
from lib import pipeline, meshutil
OUTDIR = os.path.join(ROOT, 'progress/tmp/earth-basalt-r14-build')
os.makedirs(OUTDIR, exist_ok=True)
RELEASE = '--release' in sys.argv
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

class Rock:
    def __init__(self, name):
        self.name=name; self.v=[]; self.f=[]; self.heat=[]; self.bounce=[]; self.pivot=[]; self.seed=[]; self.shade=[]; self.chunks=0
    def vertex(self, p, heat, bounce, pivot, seed, shade):
        self.v.append(tuple(p)); self.heat.append(heat); self.bounce.append(bounce)
        self.pivot.append(tuple(pivot)); self.seed.append(seed); self.shade.append(shade)
        return len(self.v)-1
    def quad(self,a,b,c,d): self.f.extend([(a,b,c),(a,c,d)])
    def finish(self):
        me=bpy.data.meshes.new(self.name); me.from_pydata(self.v,[],self.f); me.update()
        ob=bpy.data.objects.new(self.name,me); bpy.context.collection.objects.link(ob)
        # Broad prismatic face normals; the high sculpt supplies fine mineral relief.
        for poly in me.polygons: poly.use_smooth=False
        mat=bpy.data.materials.new(self.name); mat.diffuse_color=(.2,.21,.23,1);me.materials.append(mat)
        col=me.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        layers=[me.uv_layers.new(name=n) for n in ['UVMap','HeatUV','ChunkXY','ChunkZI']]
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi=me.loops[li].vertex_index; s=self.shade[vi]; p=self.pivot[vi]
                col.data[li].color=(s,s,s*.99,1)
                layers[1].data[li].uv=(self.heat[vi],self.bounce[vi])
                layers[2].data[li].uv=(p[0],p[1]); layers[3].data[li].uv=(p[2],self.seed[vi])
        me.uv_layers.active=layers[0]
        for l in layers: l.active_render=(l==layers[0])
        ob['earthChunkCount']=self.chunks
        return ob

def zig(t, seed):
    # Piecewise rock faults: at least nine direction changes over the full shaft.
    f=t*10; k=math.floor(f); u=f-k
    return (math.sin(k*2.37+seed)*.17*(1-u)+math.sin((k+1)*2.37+seed)*.17*u)

def column(variant):
    rng=random.Random(14120+variant*47); R=Rock('magic_basalt%d'%variant)
    N=6; L=3; phase=variant*.43
    def boundary(k,z):
        # A fault changes direction at the stack joints; large faces stay planar.
        return k*math.tau/N+phase+zig(z,k*.73+variant)*.48
    def width(z,k):
        layer=min(L-1,int(z*L)); t=z*L-layer
        # Three distinct pockets, each with a cold bridge and a tapered end.
        start=[.16,.10,.12][layer]; end=[.87,.90,.76][layer]
        taper=max(0,min(1,(t-start)/.18,(end-t)/.20))
        return .008+(.105+.035*math.sin(k*2.1+layer*1.7+variant))*taper
    def height(layer,a):
        if layer==0:return -.012
        if layer==L:return .99+.042*math.sin(a*2+variant)+.025*math.cos(a*3)
        return layer/L+.035*math.sin(a*3+layer*2+variant)+.012*math.cos(a*5-layer)
    for layer in range(L):
        for sector in range(N):
            seed=R.chunks+1; R.chunks+=1
            zmid=(layer+.5)/L; amid=(sector+.5)*math.tau/N+phase
            offset=Vector((.025*math.sin(layer*5+sector*3),.020*math.cos(layer*3-sector*2),0))
            pivot=Vector((math.cos(amid)*.27,math.sin(amid)*.27,zmid))+offset
            shade=rng.uniform(.81,.97); ids=[]
            # Only three broad outer planes plus thick edge bevels; no vertex noise.
            has_fork=layer==1 and sector%2==variant%2
            ring_t=[0,.14,.38,.60,.81,.91,1] if has_fork else [0,.14,.38,.68,.90,1]
            for j,v in enumerate(ring_t):
                zbase=(layer+v)/L; row=[]
                lo=boundary(sector,zbase); hi=boundary(sector+1,zbase)
                gap=width(zbase,sector)
                radius=.475+.028*math.sin(layer*5+sector)
                aa=lo+gap; bb=hi-gap
                A=Vector((math.cos(aa)*radius,math.sin(aa)*radius,0))
                B=Vector((math.cos(bb)*radius,math.sin(bb)*radius,0))
                for i,u in enumerate([0,.10,.90,1,None,None]):
                    outer=u is not None
                    if outer:
                        q=A.lerp(B,u)
                        if i in [0,3]:q*=.94
                        if j in [0,len(ring_t)-1]:q*=.94
                        if has_fork and i==1 and .3<v<.9:q*=.60
                        a=math.atan2(q.y,q.x)
                    else:
                        a=bb if i==4 else aa;q=Vector((math.cos(a)*.18,math.sin(a)*.18,0))
                    z=height(layer,a)*(1-v)+height(layer+1,a)*v+.006*(1-2*v)
                    q.z=z;p=q+offset
                    bounce=.18 if outer and (i in [0,3] or j in [0,len(ring_t)-1]) else .06
                    row.append(R.vertex(p,0 if outer else -.92,bounce,pivot,seed,shade*(1.06 if outer and (i in [0,3] or j in [0,len(ring_t)-1]) else .89)))
                ids.append(row)
            count=6
            for j in range(len(ring_t)-1):
                for i in range(count):R.quad(ids[j][i],ids[j][(i+1)%count],ids[j+1][(i+1)%count],ids[j+1][i])
            for j in [0,len(ring_t)-1]:
                points=[Vector(R.v[i]) for i in ids[j]]; c=sum(points,Vector())/count
                ci=R.vertex(c,-1,.10,pivot,seed,shade*.78)
                for i in range(count):
                    R.f.append((ci,ids[j][(i+1)%count],ids[j][i]) if j==0 else (ci,ids[j][i],ids[j][(i+1)%count]))
            def basin(fork=False):
                rows=[]
                for j in range(5):
                    t=j/4; v=(.38+t*.43) if fork else t; z=(layer+v)/L
                    a=boundary(sector,z)
                    w=width(z,sector)
                    if fork:
                        # A short diagonal Y branch opens toward a seam, then terminates in cold stone.
                        a+=.23*t;w=.003+w*.56*math.sin(math.pi*t)
                    row=[]
                    for i,u in enumerate([-1,-.52,0,.52,1]):
                        aa=a+w*u;rad=.292+.118*abs(u)**1.4
                        zz=height(layer,a)*(1-v)+height(layer+1,a)*v
                        p=Vector((math.cos(aa)*rad,math.sin(aa)*rad,zz))+offset
                        hot=max(0,1-abs(u)**.72)*(1-.30*z)*min(1,max(0,(w-.010)/.055))
                        row.append(R.vertex(p,hot,.10,pivot,seed,shade*.65))
                    rows.append(row)
                for j in range(4):
                    for i in range(4):R.quad(rows[j][i],rows[j][i+1],rows[j+1][i+1],rows[j+1][i])
                perimeter=rows[0]+[r[-1] for r in rows[1:]]+list(reversed(rows[-1][:-1]))+[r[0] for r in reversed(rows[1:-1])]
                centre=sum((Vector(R.v[vi]) for vi in perimeter),Vector())/len(perimeter);centre.x*=.65;centre.y*=.65
                back=R.vertex(centre,-.8,.05,pivot,seed,shade*.5)
                for i,vi in enumerate(perimeter):R.f.append((back,perimeter[(i+1)%len(perimeter)],vi))
            basin()
            if has_fork:basin(True)
    return R.finish()

def add_mass(R, centre, scale, seed, angles=(0,0,0), block=False, detail=1, channels=False):
    # Sculpted angular rock mass; bevelled thick shoulders, chipped faces and an unequal silhouette.
    if channels and seed==3:
        bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=.88,radius2=1.08,depth=2,location=(0,0,0))
    elif block:bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,0))
    else:bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1)
    ob=bpy.context.object
    if block:
        mod=ob.modifiers.new('thick chipped edges','BEVEL');mod.width=.11 if channels and seed==3 else .54;mod.segments=3
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=mod.name)
        if detail:
            mod=ob.modifiers.new('sculpt grid','SUBSURF');mod.subdivision_type='SIMPLE';mod.levels=detail;bpy.ops.object.modifier_apply(modifier=mod.name)
    from mathutils import Euler
    rot=Euler(angles).to_matrix();pivot=Vector(centre); start=len(R.v)
    for vi in ob.data.vertices:
        p=vi.co.copy(); a=math.atan2(p.y,p.x); zz=p.z
        # Branching channels carved into the mass, not just a colour painted on its facet edges.
        d=min(abs(math.sin(a*2+zig(zz*.5+.5,seed)*4)),abs(math.sin(a*3-zz*2+seed))+.18)
        if channels:
            path=-.20+zig((zz+1)*.5,seed)*1.8+.07*math.sin(p.y*5)
            branch=.48+zig((zz+1)*.5,seed+7)*1.2
            d=min(abs(p.x-path),abs(p.x-branch)+.025)
        groove=max(0,1-d/(.22 if not channels else .26)); rough=(.018 if block else .055)*math.sin(p.x*4+p.y*3+seed)*math.sin(p.z*5-p.x*4)
        p*=1+rough-groove*.065
        q=pivot+rot@Vector(tuple(p[i]*scale[i] for i in range(3)))
        R.vertex(q,0 if channels else groove**1.8*.70,.06 if channels else math.exp(-d/.23)*.35,pivot,seed,(.70+.24*math.sin(seed*2.1)**2)*(.80+.20*math.sin(p.x*11+p.y*8+p.z*7+seed)**2))
    for face in ob.data.polygons:
        ids=[start+i for i in face.vertices]
        if channels:
            # Face-constant joint metadata: sharing cap vertices with side walls would
            # interpolate magma across the whole finger/arm, making a molten marbled block.
            joint=.35<abs(face.normal.z)<.93 and seed not in [1,5,8,11,14,20]
            if seed==3:joint=-.93<face.normal.z<-.35
            heat=.46 if joint else 0
            ids=[R.vertex(R.v[vi],heat,.13 if joint else .025,R.pivot[vi],R.seed[vi],R.shade[vi]) for vi in ids]
        for i in range(1,len(ids)-1):R.f.append((ids[0],ids[i],ids[i+1]))
    R.chunks+=1;bpy.data.objects.remove(ob,do_unlink=True)

def loose_rock():
    R=Rock('magic_earth_chip');add_mass(R,(0,0,.40),(.42,.36,.40),1)
    return R.finish()

def boulder():
    R=Rock('magic_earth_boulder')
    for seed,centre,scale in [(1,(0,0,0),(.85,.68,.70)),(2,(-.58,.12,.10),(.48,.46,.49)),(3,(.41,-.26,.29),(.53,.43,.50))]:
        add_mass(R,centre,scale,seed,block=False)
    return R.finish()

def fist():
    R=Rock('magic_earth_fist')
    # A knuckles-down closed fist. Negative Blender Y faces the gameplay camera.
    # A broad metacarpal bridge sits behind four fingers, never in front of their silhouette.
    add_mass(R,(0,.13,.95),(.76,.35,.48),1,block=True,detail=0,channels=True)
    # Tapering forearm and wrist carry the titan scale cue above the curled hand.
    add_mass(R,(0,.14,1.55),(.47,.34,.29),2,block=True,detail=0,channels=True)
    add_mass(R,(-.02,.18,2.22),(.51,.39,.79),3,angles=(0,.05,.025),block=True,detail=0,channels=True)
    for i,x in enumerate([-.64,-.22,.22,.64]):
        f=[.88,1.04,1,.86][i]
        # Wide proximal fingers, compact distal curl, dark gaps of genuine thickness.
        add_mass(R,(x,-.29,.30),(.181,.32*f,.24),5+i*3,angles=(.08,0,(i-1.5)*.035),block=True,detail=0,channels=True)
        add_mass(R,(x,-.58*f,.61),(.173,.23,.22*f),6+i*3,angles=(-.20,0,0),block=True,detail=0,channels=True)
        add_mass(R,(x,-.40,.91),(.166,.20,.16),7+i*3,angles=(.36,0,0),block=True,detail=0,channels=True)
    # Opposed thumb projects to the side, then bends across the index finger.
    add_mass(R,(.99,-.13,.96),(.26,.26,.31),18,angles=(.12,.12,-.28),block=True,detail=0,channels=True)
    add_mass(R,(.92,-.55,.80),(.20,.27,.19),19,angles=(.1,.25,-.55),block=True,detail=0,channels=True)
    add_mass(R,(.57,-.77,.75),(.26,.16,.15),20,angles=(.12,.2,-.12),block=True,detail=0,channels=True)
    return R.finish()

obs=[column(i) for i in range(3)]+[loose_rock(),boulder(),fist()]
# UV islands are unwrapped per game mesh then assigned one stable tile in the shared normal/AO atlas.
for tile,ob in enumerate(obs):
    meshutil.select_only([ob],ob);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.1,island_margin=.025);bpy.ops.object.mode_set(mode='OBJECT')
    for uv in ob.data.uv_layers['UVMap'].data:
        uv.uv=( (tile%3+ .04+uv.uv.x*.92)/3, (tile//3+.04+uv.uv.y*.92)/2 )
# Bake from displaced subdivision sculpts, retaining original low topology and fracture metadata.
pipeline.setup_cycles(samples=8)
res=1024
normal=pipeline.new_image('basalt_normal',res,color=(.5,.5,1,1))
ao=pipeline.new_image('basalt_ao',res,color=(1,1,1,1))
normal.colorspace_settings.name='Non-Color';ao.colorspace_settings.name='Non-Color'
for ob in obs:
    for other in obs:other.hide_render=other!=ob
    hi=ob.copy();hi.data=ob.data.copy();bpy.context.collection.objects.link(hi);hi.name=ob.name+'_sculpt'
    meshutil.select_only([hi],hi)
    sub=hi.modifiers.new('sculpt resolution','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=4
    bpy.ops.object.modifier_apply(modifier=sub.name)
    tex=bpy.data.textures.new(hi.name+'_chips',type='CLOUDS');tex.noise_scale=.012;tex.noise_depth=2
    dis=hi.modifiers.new('basalt micro chips','DISPLACE');dis.texture=tex;dis.strength=.003;dis.mid_level=.5
    bpy.ops.object.modifier_apply(modifier=dis.name)
    hi.hide_render=False
    pipeline.bake_pass(ob,[hi],normal,kind='NORMAL',extrusion=.018,max_ray=.045,samples=4)
    pipeline.bake_pass(ob,[hi],ao,kind='AO',extrusion=.018,max_ray=.045,samples=8)
    bpy.data.objects.remove(hi,do_unlink=True)
# AO also supplies the cavity modulation: two scales avoid a dirty uniform face tint.
a= pipeline.image_np(ao);n=pipeline.image_np(normal)
print('BAKE_RANGE',float(n[:,:,:3].min()),float(n[:,:,:3].max()),float(np.std(n[:,:,0])),float(a[:,:,:3].min()),flush=True)
assert np.std(n[:,:,0])>.001 and a[:,:,:3].min()<.98,'Blank normal/AO bake rejected'
a[:,:,:3]=np.clip(a[:,:,:3],.15,1)
# One atlas carries true baked cavity in R and restrained mineral roughness in G.
yy,xx=np.mgrid[0:res,0:res]
a[:,:,1]=np.clip(.88+.055*np.sin(xx*.13)*np.sin(yy*.17)+(1-a[:,:,0])*.07,.83,.99)
ao.pixels.foreach_set(a.ravel())
# Save actual selected-to-active bake outputs (never concept image pixels).
for image,name in [(normal,'magic_earth_normal.png'),(ao,'magic_earth_ao.png')]:
    image.filepath_raw=os.path.join(OUTDIR,name);image.file_format='PNG';image.save()
# Mineral grain uses UV0 atlas too. AO/cavity is sampled separately at runtime.
yy,xx=np.mgrid[0:1024,0:1024];rng=np.random.default_rng(1212)
v=.54+(rng.random((1024,1024))-.5)*.23
rgba=np.ones((1024,1024,4),dtype=np.float32);rgba[:,:,:3]=v[:,:,None]*np.array([1.015,1,.97])
im=bpy.data.images.new('basalt_mineral',width=1024,height=1024,alpha=True);im.pixels.foreach_set(rgba.ravel());im.filepath_raw=os.path.join(OUTDIR,'magic_earth_basalt.png');im.file_format='PNG';im.save()
manifest=[]
for ob in obs:
    ob.hide_render=False;meshutil.select_only([ob],ob)
    tris=sum(len(p.vertices)-2 for p in ob.data.polygons)
    assert tris<16000,(ob.name,tris)
    out=os.path.join(OUTDIR,ob.name+'.glb')
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_normals=True,
        export_texcoords=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_materials='EXPORT')
    manifest.append(dict(name=ob.name,triangles=tris,chunks=ob['earthChunkCount'],bytes=os.path.getsize(out)))
    print('EARTH_R14_ASSET',manifest[-1],flush=True)
# Publish complete family only; failed Blender Python scripts sometimes return exit 0.
if '--no-publish' not in sys.argv:
    for ob in obs:shutil.copyfile(os.path.join(OUTDIR,ob.name+'.glb'),os.path.join(ROOT,'public/assets/models',ob.name+'.glb'))
    for name in ['magic_earth_normal.png','magic_earth_ao.png','magic_earth_basalt.png']:
        shutil.copyfile(os.path.join(OUTDIR,name),os.path.join(ROOT,'public/assets/textures',name))
with open(os.path.join(OUTDIR,'manifest.json'),'w') as f:json.dump(dict(release=RELEASE,assets=manifest),f,indent=2)
print('EARTH_C2_R14_FAMILY_COMPLETE',flush=True)
