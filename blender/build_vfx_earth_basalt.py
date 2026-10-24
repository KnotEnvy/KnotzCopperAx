"""C2 r13: sculpted, stacked basalt joint masses, with full-height recessed magma channels.
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
OUTDIR = os.path.join(ROOT, 'progress/tmp/earth-basalt-r13-build')
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
        # Continuous sculpted normals, with the shape and dense bake carrying chips.
        for poly in me.polygons: poly.use_smooth=True
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
    rng=random.Random(12120+variant*47); R=Rock('magic_basalt%d'%variant)
    N=7; L=4; arc=6; rings=7
    phase=variant*.43
    def aperture(z,k):
        # Three genuine closures per shaft, opening into unequal pockets between.
        pinch=abs(math.sin(z*math.pi*3+k*.31+variant*.2))
        return .022+.155*pinch**.65
    def boundary(k,z): return k*math.tau/N+phase+zig(z,k*.73+variant)+.055*math.sin(z*19+k)
    def height(k,layer,a):
        if layer==0:return -.012
        if layer==L:return 1.0+.085*math.sin(a*3+variant)+.055*math.sin(a*11+1)+.035*math.sin(a*23)
        return layer/L+.030*math.sin(a*3+layer*2+variant)+.014*math.cos(a*8-layer)
    for layer in range(L):
        for sector in range(N):
            seed=R.chunks+1; R.chunks+=1
            zmid=(layer+.5)/L; amid=(sector+.5)*math.tau/N+phase
            offset=Vector((.050*math.sin(layer*5+sector*3),.045*math.cos(layer*3-sector*2),0))
            pivot=Vector((math.cos(amid)*.27,math.sin(amid)*.27,zmid))+offset
            shade=rng.uniform(.70,.98); ids=[]
            for j in range(rings):
                v=j/(rings-1); zbase=(layer+v)/L
                # Irregular lower and upper fracture lips. Each mass is chunky, never a whole-shaft plate.
                gap=.009 if layer else .002
                row=[]
                lo=boundary(sector,zbase); hi=boundary(sector+1,zbase)
                halfgap=aperture(zbase,sector)
                # Outer arc + inward return creates a CLOSED thick wedge at every stack joint.
                for i in range(arc+3):
                    outer=i<=arc
                    if outer:
                        u=i/arc; a=lo+halfgap+(hi-lo-2*halfgap)*u
                        edge=min(u,1-u); bevel=min(1,edge*12, v*9,(1-v)*9)
                        rad=(.455+.052*math.sin(layer*5+sector)+.022*math.sin(zbase*41+a*11))*(.94+.06*bevel)
                        # Chipped central facets and shoulder steps break the silhouette even unlit.
                        rad+=.030*math.sin(a*37+zbase*29)*math.sin(zbase*61+a*13)+.012*math.sin(a*71-zbase*93)
                    else:
                        a=hi-halfgap if i==arc+1 else lo+halfgap; rad=.19
                    z=height(sector,layer,a)*(1-v)+height(sector,layer+1,a)*v
                    z+=gap*(1-2*v)
                    p=Vector((math.cos(a)*rad,math.sin(a)*rad,z))+offset
                    # Exposed sides carry red embers on collapse. Heat is strongest deep in the channel.
                    heat=0 if outer else -.85
                    d=min(abs(a-lo),abs(hi-a))*.455
                    bounce=math.exp(-d/.052)*(.65+.35*math.sin(z*19+sector)**2) if outer else .18
                    row.append(R.vertex(p,heat,bounce,pivot,seed,shade*(.80+.20*math.sin(j*2.7+i*1.9)**2)))
                ids.append(row)
            count=arc+3
            for j in range(rings-1):
                for i in range(count):R.quad(ids[j][i],ids[j][(i+1)%count],ids[j+1][(i+1)%count],ids[j+1][i])
            for j in [0,rings-1]:
                points=[Vector(R.v[i]) for i in ids[j]]; c=sum(points,Vector())/count
                c.z+=.018*math.sin(seed*4.1)
                ci=R.vertex(c,-1,.12,pivot,seed,shade*.68)
                for i in range(count):
                    tri=(ci,ids[j][(i+1)%count],ids[j][i]) if j==0 else (ci,ids[j][i],ids[j][(i+1)%count])
                    R.f.append(tri)
            # Deep irregular channel bottom: a solid recessed hot ribbon, connected visually up to the crown.
            # Its width pinches/opens, with dark side walls and a yellow core feathered through orange/red.
            rows=[]
            for j in range(10):
                v=j/9; z=(layer+v)/L; a=boundary(sector,z)
                width=aperture(z,sector)
                row=[]
                for i in range(9):
                    u=(i-4)/4; aa=a+width*u
                    rad=.285+.100*abs(u)**1.6+.008*math.sin(z*37+sector)
                    zz=height(sector,layer,a)*(1-v)+height(sector,layer+1,a)*v
                    p=Vector((math.cos(aa)*rad,math.sin(aa)*rad,zz))+offset
                    hot=(1.0-.92*abs(u)**.72)*(1-.38*z)*(.86+.14*math.sin(z*24+sector)**2)
                    # Dull red pinch points interrupt uniform neon ladders.
                    hot*=.50+.50*min(1,width/.09)
                    row.append(R.vertex(p,hot,.15,pivot,seed,shade*.58))
                rows.append(row)
            for j in range(9):
                for i in range(8):
                    R.quad(rows[j][i],rows[j][i+1],rows[j+1][i+1],rows[j+1][i])
            # Hidden backing is a closed fan, not another dense copy of the visible basin.
            perimeter=rows[0]+[row[-1] for row in rows[1:]]+list(reversed(rows[-1][:-1]))+[row[0] for row in reversed(rows[1:-1])]
            centre=sum((Vector(R.v[vi]) for vi in perimeter),Vector())/len(perimeter)
            centre.x*=.65;centre.y*=.65
            back=R.vertex(centre,-.8,.05,pivot,seed,shade*.5)
            for i,vi in enumerate(perimeter):R.f.append((back,perimeter[(i+1)%len(perimeter)],vi))
    return R.finish()

def add_mass(R, centre, scale, seed, angles=(0,0,0), block=False, detail=1, channels=False):
    # Sculpted angular rock mass; bevelled thick shoulders, chipped faces and an unequal silhouette.
    bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,0)) if block else bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1)
    ob=bpy.context.object
    if block:
        mod=ob.modifiers.new('thick chipped edges','BEVEL');mod.width=.37;mod.segments=2
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=mod.name)
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
        groove=max(0,1-d/(.22 if not channels else .26)); rough=.11*math.sin(p.x*7+p.y*5+seed)*math.sin(p.z*9-p.x*7)+.025*math.sin(p.y*23+p.z*19)
        p*=1+rough-groove*.065
        q=pivot+rot@Vector(tuple(p[i]*scale[i] for i in range(3)))
        R.vertex(q,groove**1.8*.88,math.exp(-d/.23)*.45,pivot,seed,(.70+.24*math.sin(seed*2.1)**2)*(.80+.20*math.sin(p.x*11+p.y*8+p.z*7+seed)**2))
    for face in ob.data.polygons:
        ids=[start+i for i in face.vertices]
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
    add_mass(R,(0,.08,.94),(.84,.42,.51),1,block=True,detail=2,channels=True)
    add_mass(R,(0,.10,1.48),(.46,.34,.23),2,block=False,channels=True)
    add_mass(R,(-.05,.12,1.72),(.42,.31,.21),3,angles=(.08,-.09,.12),block=False,channels=True)
    add_mass(R,(.03,.18,1.88),(.38,.28,.14),4,angles=(.03,.12,-.10),block=False,channels=True)
    for i,x in enumerate([-.61,-.20,.22,.63]):
        f=[.86,1.02,1,.91][i]
        # Four separate knuckle striking blocks; curled fingers rise along the front, tips tuck into palm.
        add_mass(R,(x*1.08,-.28,.24),(.175,.35*f,.23),5+i*3,angles=(.05,0,(i-1.5)*.035),block=False,channels=True)
        add_mass(R,(x*1.08,-.64*f,.51),(.16,.25,.27*f),6+i*3,angles=(-.18,0,0),block=False,channels=True)
        add_mass(R,(x*1.02,-.48,.80),(.15,.24,.16),7+i*3,angles=(.32,0,0),block=False,channels=True)
    add_mass(R,(.91,-.22,.93),(.23,.28,.34),18,angles=(.2,.1,.2),block=False,channels=True)
    add_mass(R,(.65,-.77,.80),(.29,.20,.22),19,angles=(0,.4,-.4),block=False,channels=True)
    add_mass(R,(.22,-.85,.71),(.31,.17,.17),20,angles=(0,.2,-.1),block=False,channels=True)
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
    sub=hi.modifiers.new('sculpt resolution','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=2
    bpy.ops.object.modifier_apply(modifier=sub.name)
    tex=bpy.data.textures.new(hi.name+'_chips',type='CLOUDS');tex.noise_scale=.035;tex.noise_depth=2
    dis=hi.modifiers.new('basalt micro chips','DISPLACE');dis.texture=tex;dis.strength=.030;dis.mid_level=.5
    bpy.ops.object.modifier_apply(modifier=dis.name)
    hi.hide_render=False
    pipeline.bake_pass(ob,[hi],normal,kind='NORMAL',extrusion=.04,max_ray=.09,samples=4)
    pipeline.bake_pass(ob,[hi],ao,kind='AO',extrusion=.04,max_ray=.09,samples=8)
    bpy.data.objects.remove(hi,do_unlink=True)
# AO also supplies the cavity modulation: two scales avoid a dirty uniform face tint.
a= pipeline.image_np(ao);n=pipeline.image_np(normal)
print('BAKE_RANGE',float(n[:,:,:3].min()),float(n[:,:,:3].max()),float(np.std(n[:,:,0])),float(a[:,:,:3].min()),flush=True)
assert np.std(n[:,:,0])>.001 and a[:,:,:3].min()<.98,'Blank normal/AO bake rejected'
a[:,:,:3]=np.clip(a[:,:,:3],.15,1)
# Save actual selected-to-active bake outputs (never concept image pixels).
for image,name in [(normal,'magic_earth_normal.png'),(ao,'magic_earth_ao.png')]:
    image.filepath_raw=os.path.join(OUTDIR,name);image.file_format='PNG';image.save()
# Mineral grain uses UV0 atlas too. AO/cavity is sampled separately at runtime.
yy,xx=np.mgrid[0:512,0:512];rng=np.random.default_rng(1212)
v=.58+.04*np.sin(xx*.13+yy*.21)*np.sin(yy*.07-xx*.11)+(rng.random((512,512))-.5)*.16
rgba=np.ones((512,512,4),dtype=np.float32);rgba[:,:,:3]=v[:,:,None]*np.array([1,1,.99])
im=bpy.data.images.new('basalt_mineral',width=512,height=512,alpha=True);im.pixels.foreach_set(rgba.ravel());im.filepath_raw=os.path.join(OUTDIR,'magic_earth_basalt.png');im.file_format='PNG';im.save()
manifest=[]
for ob in obs:
    ob.hide_render=False;meshutil.select_only([ob],ob)
    tris=sum(len(p.vertices)-2 for p in ob.data.polygons)
    assert tris<16000,(ob.name,tris)
    out=os.path.join(OUTDIR,ob.name+'.glb')
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_normals=True,
        export_texcoords=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_materials='EXPORT')
    manifest.append(dict(name=ob.name,triangles=tris,chunks=ob['earthChunkCount'],bytes=os.path.getsize(out)))
    print('EARTH_R13_ASSET',manifest[-1],flush=True)
# Publish complete family only; failed Blender Python scripts sometimes return exit 0.
for ob in obs:shutil.copyfile(os.path.join(OUTDIR,ob.name+'.glb'),os.path.join(ROOT,'public/assets/models',ob.name+'.glb'))
for name in ['magic_earth_normal.png','magic_earth_ao.png','magic_earth_basalt.png']:
    shutil.copyfile(os.path.join(OUTDIR,name),os.path.join(ROOT,'public/assets/textures',name))
with open(os.path.join(OUTDIR,'manifest.json'),'w') as f:json.dump(dict(release=RELEASE,assets=manifest),f,indent=2)
print('EARTH_C2_R13_FAMILY_COMPLETE',flush=True)
