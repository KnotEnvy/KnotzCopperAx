"""C2 r18: columns = continuous chamfered prisms broken by tilted glowing joints, large silhouette spalls, steep
varied crown breaks and baked jagged forking crack networks (no slits, no warm spill); the fist is carved from
bevelled stone blocks (knuckle row, finger planes with real gaps, wrapped thumb, narrow wrist, forearm) in a baked pose.
C2 r17: dark faceted basalt (chamfered edges, per-face value steps), fractured asymmetric prisms (leaning, snapped,
split and chipped crowns), forked magma junctions, an articulated titan fist and cracked debris.
C2 r16 base: continuous hexagonal basalt prisms, a connected clenched titan fist and irregular break faces.
ONLY run via tools/blender-run.mjs. Preview/release have identical game topology.
A displaced subdivision sculpt is baked to the game mesh: tangent normal + AO/cavity.
UV1 = signed heat (negative = fresh break)/bounce, UV2/3 = rigid fracture pivot/id.
UV0 = shared metric six-asset atlas. AO.R=cavity, AO.G=roughness, AO.B=sharp branching heat.
Flags: --release (finer sculpt) · --no-publish · --geometry-only (no bake/textures, GLBs to OUTDIR only).
Design (board r15): a column prism is ONE continuous shaft. Its rigid collapse chunks meet on hidden, tilted,
faceted break planes (coincident while intact: no horizontal seams); crowns are chamfered and faceted; the magma
runs in one meandering, tapering channel per prism with a diverging branch; warm bounce spills onto neighbours.
Design (board r16): every hex corner carries a narrow chamfer facet (12-point ring) and the vertex colour is a
PER-FACE value step from a fixed key direction (>= 15 % between neighbouring faces, bevel highlight on key-side
edges) so the facets read in the full frame; the pigment is cool blue-black; the warm spill is cut back. Prisms lean,
one per cluster is snapped (offset, shrunk upper shaft on a tilted ledge), one kinks above its break, one has a split
crown, one a spalled corner; crowns are tilted break planes of varied cut. Four magma motifs: fork that pools at a
wide junction and runs over the edge onto the adjacent face, inverted fork from the base, a jag that crosses the
edge, and a dying channel. The fist has negative-field finger gaps, a hard knuckle row, a tapered wrist and a cube-
element faceted forearm; chips carry a glowing crack.
"""
import bpy, math, os, sys, random, shutil, json
import numpy as np
from mathutils import Vector, Euler
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'blender'))
from lib import pipeline, meshutil
OUTDIR = os.path.join(ROOT, 'progress/tmp/earth-basalt-r18-build')
os.makedirs(OUTDIR, exist_ok=True)
RELEASE = '--release' in sys.argv
GEOMETRY_ONLY = '--geometry-only' in sys.argv
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
COLUMN_SCALE = (1.4, 1.4, 3.65)   # unit column mesh -> gameplay metres (unwrap/sculpt/bake/spill use this)

KEY=Vector((-.62,-.66,.42)).normalized()   # fixed key for the baked per-face value steps (upper left, camera side)
class Rock:
    def __init__(self, name, facet=1.0):
        self.name=name; self.v=[]; self.f=[]; self.heat=[]; self.bounce=[]; self.pivot=[]; self.seed=[]; self.shade=[]; self.chunks=0
        self.facet=facet   # strength of the per-face key step (1 = columns)
    def vertex(self, p, heat, bounce, pivot, seed, shade):
        self.v.append(tuple(p)); self.heat.append(heat); self.bounce.append(bounce)
        self.pivot.append(tuple(pivot)); self.seed.append(seed); self.shade.append(shade)
        return len(self.v)-1
    def quad(self,a,b,c,d): self.f.extend([(a,b,c),(a,c,d)])
    def fan(self, ring, centre, up):
        # Faceted cap: the centre vertex is offset so every triangle has its own normal.
        n=len(ring)
        for k in range(n): self.f.append((centre,ring[(k+1)%n],ring[k]) if not up else (centre,ring[k],ring[(k+1)%n]))
    def spill(self, scale, radius=.34, gain=.55):
        # Warm light from molten channels falls on neighbouring stone faces (metric falloff).
        hot=np.array([np.array(self.v[i])*scale for i,h in enumerate(self.heat) if h>.3])
        if not len(hot): return
        P=np.array(self.v)*scale
        d=np.sqrt(((P[:,None,:]-hot[None,:,:])**2).sum(-1)).min(1)
        for i in range(len(self.v)):
            if self.heat[i]<=.05: self.bounce[i]=max(self.bounce[i], gain*math.exp(-d[i]/radius))
    def finish(self):
        # r18: drop zero-area faces (clamped coincident rows, collapsed bevel corners) - they draw nothing but break
        # the family manifold check (an edge between coincident points is counted 4-6 times).
        key=lambda i: tuple(round(c*1e6) for c in self.v[i])
        self.f=[f for f in self.f if len({key(i) for i in f})==len(f)]
        me=bpy.data.meshes.new(self.name); me.from_pydata(self.v,[],self.f); me.update()
        ob=bpy.data.objects.new(self.name,me); bpy.context.collection.objects.link(ob)
        for poly in me.polygons: poly.use_smooth=False
        mat=bpy.data.materials.new(self.name); mat.diffuse_color=(.2,.21,.23,1);me.materials.append(mat)
        col=me.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        layers=[me.uv_layers.new(name=n) for n in ['UVMap','HeatUV','ChunkXY','ChunkZI']]
        for poly in me.polygons:
            # r17: crisp per-FACE value step (board: adjacent hex faces got the same light -> rounded cylinders).
            # A fixed key gives neighbouring faces >= 15 % luminance difference and a bevel highlight where a
            # chamfer facet points at the key; up-facing facets are a step lighter (sky).
            n=poly.normal; d=max(0.,n.dot(KEY))
            fs=1.+self.facet*((.54+.46*d)-1.+.15*d**10+(.06 if n.z>.6 else 0.))
            for li in poly.loop_indices:
                vi=me.loops[li].vertex_index; s=self.shade[vi]*fs; p=self.pivot[vi]
                col.data[li].color=(s*.97,s,s*1.04,1)
                layers[1].data[li].uv=(self.heat[vi],self.bounce[vi])
                layers[2].data[li].uv=(p[0],p[1]); layers[3].data[li].uv=(p[2],self.seed[vi])
        me.uv_layers.active=layers[0]
        for l in layers: l.active_render=(l==layers[0])
        ob['earthChunkCount']=self.chunks
        return ob

def sstep(a,b,x):
    u=max(0.,min(1.,(x-a)/(b-a))); return u*u*(3-2*u)

# r18 (board r17: "charred wooden posts" - long straight luminous slits parallel to the edges, similar crowns).
# A prism is a continuous 12-point chamfered shaft broken by two TILTED joints (diagonal fracture planes). Each joint is
# a shallow groove whose floor glows on the camera side and is interrupted; the shaft carries large asymmetric SPALLS
# (missing wedges at a silhouette corner) and a crown cut on a steep break plane of its own angle. The magma lives in
# the joints, a hot root seam and a baked jagged forking crack network (heat atlas, same language as L1/L3) - no
# geometric slits and no metric warm spill (it washed the lit faces maroon).
# Per cluster: prism 0 is the dominant shaft. Styles: snap (offset, shrunk upper shaft), kink (upper shaft leans away
# above the top joint), split (V-notched crown), chip (spalled crown corner).
STYLES=[['snap','kink','split','chip'],['kink','snap','chip','split'],['split','snap','kink','chip']]
CHAMFER=.11   # chamfer facet width as a fraction of a hex edge
COLD=[3,2,1]  # one dim (cooling) prism per cluster
COLUMN_PRISMS={}   # variant -> crack metadata per prism, consumed by heat_atlas

def column(variant):
    rng=random.Random(18120+variant*53); R=Rock('magic_basalt%d'%variant)
    cluster=[(-.12,.09,.265,1.0),(.25,.12,.205,.78),(-.29,-.22,.19,.57),(.13,-.24,.225,.69)]
    th=variant*2.13; cam=Vector((-math.sin(th),-math.cos(th),0)); cam_ang=math.atan2(cam.y,cam.x)
    meta=COLUMN_PRISMS.setdefault(variant,[])
    for prism,(cx,cy,radius,h) in enumerate(cluster):
        h*=1+(.03*math.sin(variant*3+prism) if prism else 0)
        style=STYLES[variant][prism]; cold=prism==COLD[variant]; gain=.55 if cold else 1.
        phase=.12+variant*.19+prism*.16
        corners=[Vector((math.cos(phase+k*math.tau/6)*radius*rng.uniform(.90,1.10),math.sin(phase+k*math.tau/6)*radius*rng.uniform(.90,1.10),0)) for k in range(6)]
        centre=Vector((cx,cy,0))
        ring2d=[]
        for k in range(6):
            A=corners[k];B=corners[(k+1)%6];F=corners[(k-1)%6]
            ring2d+= [A+(F-A)*CHAMFER, A+(B-A)*CHAMFER]       # before_k, after_k (12 points, CCW)
        ring2d=ring2d[1:]+ring2d[:1]                          # start at after_0 (same ordering/winding as r17)
        angs=[math.atan2(p.y,p.x) for p in ring2d]
        def rel(j):   # signed angle of ring point j from the camera direction
            return (angs[j]-cam_ang+math.pi)%math.tau-math.pi
        lean=Vector((rng.uniform(-.10,.10),rng.uniform(-.06,.06),0))
        if prism==0: lean.x=.085 if variant%2 else -.095
        kink=Vector((rng.uniform(.05,.08)*rng.choice((-1,1)),rng.uniform(-.05,.05),0)) if style in ('kink','snap') else Vector((0,0,0))
        snap=Vector((.024*(1 if lean.x<0 else -1),-.016,0)) if style=='snap' else Vector((0,0,0))
        snap_scale=.955 if style=='snap' else 1.
        # Joints: two tilted planes z = h*c + a*x + b*y (diagonal fractures, never parallel to the crown).
        cuts=[.29+.05*math.sin(prism*2+variant), .61+.05*math.cos(prism+variant*1.7)]
        joints=[]
        for ji,c in enumerate(cuts):
            room=min(c, cuts[1]-cuts[0] if ji==0 else 1-c)*h*.42/radius
            m=min(.34,room)*rng.uniform(.65,1.)
            ang=rng.uniform(0,math.tau); joints.append((c,math.cos(ang)*m,math.sin(ang)*m))
        # Crown: a steep break plane of its own angle (per prism), corner jitter, an off-centre peak.
        ta=rng.uniform(0,math.tau); tilt=rng.uniform(.12,.27)*(1.2 if style=='kink' else 1.)   # x2.6 on screen (column aspect)
        tilt=min(tilt,(1-cuts[1])*h*.40/radius)
        sx,sy=math.cos(ta)*tilt,math.sin(ta)*tilt
        crown=[.045*math.sin(k*2.2+prism+variant)+.02*math.cos(k*4.1+variant) for k in range(12)]
        na=ta+rng.uniform(1.0,2.1); nn=Vector((math.cos(na),math.sin(na),0))
        top_scale={'snap':.93,'kink':.86,'split':.90,'chip':.90}[style]; cham_scale={'snap':.975,'kink':.95,'split':.95,'chip':.955}[style]
        def notch(lx,ly):
            if style!='split': return 0.
            return -.16*max(0.,1.-abs(lx*nn.x+ly*nn.y)/.15)
        def plane(i):
            # i: 0 ground, 1/2 joints, 3 crown
            if i==0: return lambda lx,ly: 0.
            if i<3:
                c,a,b=joints[i-1]; return lambda lx,ly,c=c,a=a,b=b: h*c+a*lx+b*ly+.010*math.sin(lx*31+ly*27)
            return lambda lx,ly: h+sx*lx+sy*ly+notch(lx,ly)
        # Silhouette corner = the chamfer pair most perpendicular to the camera (left or right edge on screen).
        side=1 if (prism+variant)%2 else -1
        sil=min(range(12),key=lambda j:abs(rel(j)-side*math.pi/2))
        front=min(range(12),key=lambda j:abs(rel(j)-(-side)*.55))
        # Spalls: (chunk, w0, w1, centre point, depth). Large missing wedges that break the silhouette.
        spalls=[]
        if prism in (0,3) or style in ('snap','kink'): spalls.append((1,.22,.78,sil,rng.uniform(.38,.52)))
        if prism==0: spalls.append((0,.30,.80,front,.30))
        if prism in (1,2): spalls.append((2,.12,.55,(sil+6)%12,rng.uniform(.30,.42)))
        if style=='chip': spalls.append((2,.50,1.01,(front+3)%12,.40))   # spalled crown corner (reaches the top ring)
        # Joint groove: depth/heat per point, strongest facing the camera and interrupted by one cold gap.
        gap=rng.randrange(12)
        def groove(ji,j):
            r=rel(j); face=max(0.,math.cos(r))**.7
            if j==gap or (ji==1 and j==(gap+5)%12): face*=.15
            return face
        def spall_f(ci,w,j):
            f=1.
            for (sc,w0,w1,jc,depth) in spalls:
                if sc!=ci or not (w0<w<w1): continue
                dj=min((j-jc)%12,(jc-j)%12)
                fall=1. if dj==0 else (.62 if dj==1 else (.15 if dj==2 else 0.))
                lo=w0+(w1-w0)*.25; hi=w1-(w1-w0)*.25
                k=1. if lo<=w<=hi else (.55 if w<lo else .80)
                f=min(f,1-depth*fall*k)
            return f
        # Rows per chunk: (w between the chunk's bottom and top planes, kind).
        DL=.018   # joint lip offset in shaft fraction
        def rows_for(ci):
            ws=[0.]
            if ci==0: ws+= [.035/max(.3,cuts[0]), .50]
            if ci>0: ws.append(.0001)        # lip just above the joint groove floor
            if ci<2: ws.append(.9999)        # lip just below the next joint
            for (sc,w0,w1,jc,depth) in spalls:
                if sc==ci: ws+= [w for w in (w0,w0+(w1-w0)*.25,w1-(w1-w0)*.25,w1) if w<.99]
            if ci==2: ws+= [.80,.93]
            ws.append(1.)
            ws=sorted(set(round(w,4) for w in ws))
            return ws
        meta.append(dict(centre=(cx,cy),lean=(lean.x,lean.y),radius=radius,h=h,cam_ang=cam_ang,cuts=cuts,joints=joints,
                         gain=gain,side=side,seed=variant*7+prism,chunk0=R.chunks))
        bottoms=[plane(0),plane(1),plane(2)]; tops=[plane(1),plane(2),plane(3)]
        for ci in range(3):
            seed=R.chunks+1; R.chunks+=1
            ws=rows_for(ci)
            zc=(h*([0.]+cuts)[ci]+h*(cuts+[1.])[ci])/2; pivot=Vector((cx,cy,zc))
            rings=[]
            for wi,w in enumerate(ws):
                row=[]
                for j,p in enumerate(ring2d):
                    lx,ly=p.x,p.y
                    # Lip rows sit just inside the joint so the groove is a narrow V; groove floor is the joint itself.
                    zb=bottoms[ci](lx,ly); zt=tops[ci](lx,ly)
                    if ci<2 and w==1.: z=zt
                    elif ci>0 and w==0.: z=zb
                    else:
                        z=zb+(zt-zb)*w
                        if ci>0: z=max(z,zb+DL*h)
                        if ci<2: z=min(z,zt-DL*h)
                    if ci==2 and w==1.: z=zt+crown[j]*.5
                    sc=spall_f(ci,w,j)
                    if ci==2 and w==1.: sc*=top_scale
                    elif ci==2 and w==.93: sc*=cham_scale
                    heat=0.; shade=.92+.10*(z/h)
                    # groove floor: joint rows inset and hot
                    if (ci<2 and w==1.) or (ci>0 and w==0.):
                        ji=ci if (ci<2 and w==1.) else ci-1
                        g=groove(ji,j); sc*=1-.16*g; heat=.82*gain*g*(1-.12*ji); shade*=.7
                    if ci==0 and w==0.:
                        r=rel(j); heat=.74*gain*max(0.,math.cos(r*1.15))**.8; shade*=.8
                    if sc<.99: shade*=.84
                    q=Vector((lx,ly,0))*sc
                    if ci==2: q=q*snap_scale+snap
                    t=z/h
                    q=q+centre+lean*t+(kink*max(0.,t-cuts[1]) if ci==2 else Vector((0,0,0)))
                    q.z=z
                    row.append(R.vertex(q,heat,0.,pivot,seed,shade))
                rings.append(row)
            if ci==2:
                for vi in rings[-1]: R.shade[vi]*=1.10
            n=len(rings[0])
            for j in range(len(rings)-1):
                for k in range(n): R.quad(rings[j][k],rings[j][(k+1)%n],rings[j+1][(k+1)%n],rings[j+1][k])
            for which,ring_v in [('bottom',rings[0]),('top',rings[-1])]:
                ptsv=[Vector(R.v[i]) for i in ring_v]; c=sum(ptsv,Vector())/len(ptsv)
                if ci==2 and which=='top':
                    pk=Vector((sx,sy,0)).normalized()*radius*.30*top_scale
                    pz=h+sx*pk.x+sy*pk.y+.03+notch(pk.x,pk.y)
                    pq=Vector((pk.x,pk.y,0))*snap_scale+snap+centre+lean+kink*max(0.,1.-cuts[1]); pq.z=pz
                    cap=[R.vertex(R.v[vi],0.,0.,pivot,seed,1.12*(.92+.10)) for vi in ring_v]
                    ci_=R.vertex(pq,0.,0.,pivot,seed,1.18); R.fan(cap,ci_,up=True)
                elif ci==0 and which=='bottom':
                    cap=[R.vertex(R.v[vi],0.,0.,pivot,seed,.7) for vi in ring_v]
                    ci_=R.vertex(c-Vector((0,0,.01)),0.,0.,pivot,seed,.7); R.fan(cap,ci_,up=False)
                else:
                    k=ci if which=='top' else ci-1; rc=random.Random(900+variant*31+prism*7+k)
                    off=Vector((rc.uniform(-.05,.05)*radius,rc.uniform(-.05,.05)*radius,rc.uniform(-.018,.018)*h))
                    cap=[R.vertex(R.v[vi],-1.,0.,pivot,seed,.85) for vi in ring_v]
                    ci_=R.vertex(c+off,-1.,0.,pivot,seed,.9)
                    R.fan(cap,ci_,up=(which=='top'))
    return R.finish()

def crack_paths(m, scale):
    """Jagged forking crack polylines for one prism in metric (s = arc length from the camera direction, z) space.
    Returns segments as rows (s0,z0,s1,z1,w0,w1,h0,h1). Cracks start at the root seam or a joint and zig-zag
    diagonally (20-60 deg off vertical), forking once or twice; widths taper to hairlines."""
    rng=random.Random(5100+m['seed']*37)
    r=m['radius']*scale[0]; H=m['h']*scale[2]; lim=r*2.2; g=m['gain']
    segs=[]
    def walk(s,z,direction,length,w,hot,forks,lean):
        travelled=0.; sgn=rng.choice((-1,1))
        while travelled<length:
            ang=lean+sgn*rng.uniform(.35,1.0); sgn=-sgn
            L=rng.uniform(.10,.24)
            ds=math.sin(ang)*L; dz=math.cos(ang)*L*direction
            s1=max(-lim,min(lim,s+ds)); z1=max(.02,min(H*.985,z+dz))
            k0=1-travelled/length; k1=max(0.,1-(travelled+L)/length)
            # sub-jitter so even a straight leg is ragged at the game camera
            mx,mz=(s+s1)/2+rng.uniform(-.025,.025),(z+z1)/2+rng.uniform(-.02,.02)
            for (a,b,c,d,u0,u1) in [(s,z,mx,mz,k0,(k0+k1)/2),(mx,mz,s1,z1,(k0+k1)/2,k1)]:
                segs.append((a,b,c,d,max(.013,w*(.40+.60*u0)),max(.011,w*(.40+.60*u1)),hot*(.70+.30*u0),hot*(.70+.30*u1)))
            if forks>0 and rng.random()<.45 and travelled>.12:
                walk(s1,z1,direction,length*rng.uniform(.30,.50),w*.6,hot*.88,forks-1,lean+rng.choice((-1,1))*rng.uniform(.5,.9))
                forks-=1
            s,z=s1,z1; travelled+=L
            if z1<=.03 or z1>=H*.98: break
    side=m['side']
    # root crack: from the hot base seam up toward the first joint (widest, hottest)
    walk(rng.uniform(-.35,.35)*r,.02,1,H*m['cuts'][0]*rng.uniform(.95,1.25),.062,.90*g,2,side*rng.uniform(.15,.4))
    # from the lower joint up into the middle block, and down from the upper joint (cracks meet the joints)
    for ji,(c,a,b) in enumerate(m['joints']):
        for direction in ((1,) if ji==1 else (1,-1)):
            if rng.random()<(.55 if direction<0 else .95):
                s0=rng.uniform(-.45,.45)*r
                lx,ly=m['radius']*math.cos(m['cam_ang']+s0/r),m['radius']*math.sin(m['cam_ang']+s0/r)
                walk(s0,(m['h']*c+a*lx+b*ly)*scale[2],direction,H*rng.uniform(.18,.30),.050*(1-.15*ji),.80*g*(1-.1*ji),1,-side*rng.uniform(.1,.5)*direction)
    return np.array(segs,np.float64)

def column_crack_atlas(heat,ob,variant,res):
    """Rasterize the prism crack networks into the shared AO.B heat atlas (column metres; mesh is scaled here)."""
    me=ob.data;uv=me.uv_layers['UVMap'];seeds=me.uv_layers['ChunkZI']
    S=COLUMN_SCALE; prisms=COLUMN_PRISMS[variant]
    paths=[crack_paths(m,S) for m in prisms]
    for poly in me.polygons:
        seed=round(seeds.data[poly.loop_start].uv.y); pi=(seed-1)//3
        if pi<0 or pi>=len(prisms): continue
        m=prisms[pi]; segs=paths[pi]
        if not len(segs): continue
        lis=list(poly.loop_indices)
        for tri in [(lis[0],lis[i],lis[i+1]) for i in range(1,len(lis)-1)]:
            t=np.array([uv.data[li].uv[:] for li in tri])*res
            q=np.array([me.vertices[me.loops[li].vertex_index].co[:] for li in tri])
            x0,y0=np.maximum(0,np.floor(t.min(axis=0)).astype(int));x1,y1=np.minimum(res-1,np.ceil(t.max(axis=0)).astype(int))
            xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
            den=(t[1,1]-t[2,1])*(t[0,0]-t[2,0])+(t[2,0]-t[1,0])*(t[0,1]-t[2,1])
            if abs(den)<1e-10: continue
            a=((t[1,1]-t[2,1])*(xx-t[2,0])+(t[2,0]-t[1,0])*(yy-t[2,1]))/den
            b=((t[2,1]-t[0,1])*(xx-t[2,0])+(t[0,0]-t[2,0])*(yy-t[2,1]))/den;c=1-a-b
            inside=(a>=-.02)&(b>=-.02)&(c>=-.02)
            if not inside.any(): continue
            p=a[:,:,None]*q[0]+b[:,:,None]*q[1]+c[:,:,None]*q[2]
            z=p[:,:,2]; tt=z/(m['h']*S[2])
            ax=m['centre'][0]*S[0]+m['lean'][0]*S[0]*tt; ay=m['centre'][1]*S[1]+m['lean'][1]*S[1]*tt
            ang=np.arctan2(p[:,:,1]-ay,p[:,:,0]-ax)-m['cam_ang']; ang=(ang+np.pi)%(2*np.pi)-np.pi
            s=ang*m['radius']*S[0]
            P=np.stack([s[inside],z[inside]],1)
            A=segs[:,0:2];B=segs[:,2:4];AB=B-A;L2=np.maximum((AB**2).sum(1),1e-9)
            u=np.clip(((P[:,None,:]-A[None])*AB[None]).sum(2)/L2[None],0,1)
            d=np.sqrt(((P[:,None,:]-(A[None]+u[:,:,None]*AB[None]))**2).sum(2))
            w=segs[None,:,4]+(segs[None,:,5]-segs[None,:,4])*u; hv=segs[None,:,6]+(segs[None,:,7]-segs[None,:,6])*u
            val=(np.clip(1-d/w,0,1)**.65*hv).max(1)
            patch=heat[y0:y1+1,x0:x1+1]; cur=patch[inside]; patch[inside]=np.maximum(cur,val)
    return heat

def polyhedron(R, centre, scale, seed, planes=6, sub=1, roughness=.07, angles=(0,0,0), crack=None):
    # Irregular broken polyhedron: a jittered ico-sphere clipped by random planes -> flat chipped facets.
    # crack=(normal, offset, half width, heat): a glowing seam where the chunk is splitting (r17: L1 shards / chips).
    rng=random.Random(700+seed*17)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=(0,0,0))
    ob=bpy.context.object; rot=Euler(angles).to_matrix(); pivot=Vector(centre); start=len(R.v)
    cuts=[]
    for _ in range(planes):
        n=Vector((rng.gauss(0,1),rng.gauss(0,1),rng.gauss(0,1))).normalized(); cuts.append((n,rng.uniform(.58,.86)))
    pts=[]
    for vi in ob.data.vertices:
        p=vi.co.copy()
        p*=1+roughness*math.sin(p.x*5.1+seed)*math.sin(p.y*4.3-p.z*3.7+seed*.7)
        for n,d in cuts:
            s=p.dot(n)
            if s>d: p=p-n*(s-d)
        pts.append(p)
    for p in pts:
        q=pivot+rot@Vector(tuple(p[i]*scale[i] for i in range(3)))
        shade=(.84+.14*math.sin(seed*2.1)**2)*(.84+.16*math.sin(p.x*7+p.y*5+p.z*6+seed)**2)
        heat=0.
        if crack:
            cn,cd,cw,ch=crack; dist=abs(p.dot(cn)-cd+.05*math.sin(p.z*6+p.x*4))
            heat=ch*max(0.,1-dist/cw)**1.4
        R.vertex(q,heat,.02 if heat<.05 else 0.,pivot,seed,shade*(.6 if heat>.3 else 1.))
    for face in ob.data.polygons:
        ids=[start+i for i in face.vertices]
        for i in range(1,len(ids)-1):R.f.append((ids[0],ids[i],ids[i+1]))
    R.chunks+=1;bpy.data.objects.remove(ob,do_unlink=True)

def loose_rock():
    # The chip doubles as the L1 Tremor Shard (scaled tall at runtime): a broad base and a glowing crack up one side.
    R=Rock('magic_earth_chip',facet=.9);polyhedron(R,(0,0,.40),(.50,.40,.42),1,planes=7,sub=2,roughness=.10,crack=(Vector((.78,.18,.60)).normalized(),.06,.10,.80))
    return R.finish()

def boulder():
    R=Rock('magic_earth_boulder',facet=.8)
    for seed,centre,scale,ang,crack in [(1,(0,0,0),(.88,.70,.72),(0,.2,.3),(Vector((.3,-.9,.3)).normalized(),.02,.07,.55)),(2,(-.58,.12,.10),(.50,.46,.50),(.4,0,.9),None),(3,(.41,-.26,.29),(.54,.44,.52),(.1,.5,.2),(Vector((-.6,-.7,.4)).normalized(),.1,.06,.5))]:
        polyhedron(R,centre,scale,seed,planes=8,sub=3,roughness=.06,angles=ang,crack=crack)
    return R.finish()

def stone_block(R, centre, size, rot=(0,0,0), bevel=.05, seed=0, heat_fn=None, taper=None, shade=1., pivot=None, chunk_seed=1, segs=1, pose=None):
    """One closed bevelled stone block (hand frame), appended to R with per-face vertices (flat planes, per-face heat).
    taper=(axis, lo, hi): scale the two other axes from lo (at -half) to hi (at +half) along axis."""
    import bmesh
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=1.)
    for v in bm.verts:
        v.co.x*=size[0]; v.co.y*=size[1]; v.co.z*=size[2]
        if taper:
            ax,lo,hi=taper; f=lo+(hi-lo)*(v.co[ax]/size[ax]+.5)
            for k in range(3):
                if k!=ax: v.co[k]*=f
    bmesh.ops.bevel(bm,geom=list(bm.edges),offset=bevel,segments=segs,affect='EDGES',profile=.5,clamp_overlap=True)
    bmesh.ops.triangulate(bm,faces=bm.faces)
    rng=random.Random(4400+seed)
    jit={}
    for v in bm.verts:
        key=tuple(round(c,4) for c in v.co)
        if key not in jit: jit[key]=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-1,1)))*min(size)*.035
        v.co+=jit[key]
    M=Euler(rot).to_matrix(); C=Vector(centre)
    P=pose if pose is not None else Euler((0,0,0)).to_matrix()
    bm.normal_update()
    for f in bm.faces:
        n_hand=(M@f.normal).normalized()
        ids=[]
        for v in f.verts:
            h_pos=M@v.co+C; p=P@h_pos
            heat=heat_fn(h_pos,n_hand) if heat_fn else 0.
            s=shade*(.88+.12*math.sin(p.x*7+p.y*5+p.z*6+seed)**2)*(.70 if heat>0 else 1.)
            ids.append(R.vertex(p,heat,0.,pivot,chunk_seed,s))
        R.f.append(tuple(ids))
    bm.free()

FIST_POSE=None   # filled by fist(); hand frame -> mesh frame rotation (Blender, -Y = gameplay camera)
def fist():
    """r18 (board r17: "two stacked rounded boulders with a zigzag decal", thumb merged, no wrist). A carved stone
    titan fist built from bevelled blocks so every plane is crisp: four knuckle heads in a stepped row, the flat
    proximal finger planes below them separated by real gaps, curled middle phalanges, an opposed thumb wrapped across
    the front of the index/middle fingers, a clearly narrower wrist and a tapering forearm with muscle masses. Hand frame:
    x across the knuckles (thumb side +x), y punch direction (knuckle face), z back of the hand. Only the finger gaps
    and the thumb fold glow (no glyph). The pose bakes a low three-quarter hammer-down view toward the camera."""
    global FIST_POSE
    R=Rock('magic_earth_fist',facet=.85)
    pose_env=os.environ.get('KCA_FIST_POSE')
    pr=[float(v) for v in pose_env.split(',')] if pose_env else [-2.5,0.0,0.35,1.25]
    # pose = Rz(yaw) * Ry(roll) * Rx(pitch) applied to the hand frame (Blender XYZ euler), uniform scale pr[3]
    POSE=Euler((pr[0],pr[1],pr[2]),'XYZ').to_matrix()*pr[3]; FIST_POSE=POSE
    pivot=Vector((0,0,0)); seed=1; R.chunks=1
    FX=[.39,.13,-.13,-.38]; FW=[.235,.245,.235,.205]; ST=[0.,.035,0.,-.055]; RE=[0.,.04,0.,-.07]
    def gap_heat(c,n):
        # Side walls of the finger planes facing a neighbour glow only DEEP in the gap (per-vertex ramp: the visible
        # front edge stays cold stone, magma shows down inside the dark slot). r18 preview: whole-wall glow read as slats.
        if abs(n.x)<.75 or c.z>.20: return 0.
        if c.x>.47 and n.x>0: return 0.
        if c.x<-.45 and n.x<0: return 0.
        return .72*max(0.,min(1.,(.72-c.y)/.10))
    blocks=[]
    # back of the hand / metacarpals (tapers toward the wrist) and the palm heel
    blocks.append(dict(centre=(0,.12,.04),size=(1.02,.72,.40),bevel=.07,taper=(1,.80,1.0)))
    blocks.append(dict(centre=(.02,.10,-.20),size=(.86,.62,.30),bevel=.07,taper=(1,.78,1.0)))
    for i,x in enumerate(FX):
        w=FW[i]; st=ST[i]; re=RE[i]
        # knuckle head (MCP): protrudes dorsally and forward - the stepped knuckle row
        blocks.append(dict(centre=(x,.55+re,.17+st),size=(w*1.04,.33,.37),bevel=.11,segs=2))
        # proximal phalanx: the flat finger plane of the knuckle face, pointing palm-ward
        blocks.append(dict(centre=(x,.62+re,-.12+st*.5),size=(w,.24,.44),bevel=.05,heat=gap_heat,rot=(.10,0,0)))
        # middle phalanx: curled back under the palm
        blocks.append(dict(centre=(x,.42+re*.6,-.42),size=(w*.95,.42,.22),bevel=.06,rot=(-.12,0,0)))
    # thumb: thenar root on the radial side, then the thumb lying across the front of the index/middle curl
    blocks.append(dict(centre=(.50,.12,-.22),size=(.30,.56,.36),bevel=.08,rot=(.35,0,-.30)))
    blocks.append(dict(centre=(.22,.59,-.53),size=(.54,.27,.26),bevel=.08,rot=(0,.10,.14),
                       heat=lambda c,n: .45 if n.z>.75 and c.z<-.35 and c.y<.62 else 0.))
    blocks.append(dict(centre=(-.06,.64,-.50),size=(.18,.23,.21),bevel=.07,rot=(0,.15,.30)))
    # wrist (clearly narrower than the hand) and the forearm widening toward the elbow
    blocks.append(dict(centre=(0,-.33,-.02),size=(.52,.30,.34),bevel=.06))
    blocks.append(dict(centre=(0,-1.18,-.03),size=(.56,1.50,.40),bevel=.08,taper=(1,1.20,.90)))
    blocks.append(dict(centre=(.07,-1.42,-.16),size=(.48,.80,.28),bevel=.09,rot=(0,0,.06)))     # flexor mass
    blocks.append(dict(centre=(.19,-1.02,.13),size=(.26,.85,.22),bevel=.08,rot=(0,.1,-.05)))    # extensor ridge
    blocks.append(dict(centre=(-.24,-1.58,.05),size=(.22,.66,.30),bevel=.08,rot=(0,-.15,.04)))   # ulnar mass
    for bi,b in enumerate(blocks):
        stone_block(R,b['centre'],b['size'],rot=b.get('rot',(0,0,0)),bevel=b['bevel'],seed=bi,heat_fn=b.get('heat'),
                    taper=b.get('taper'),pivot=pivot,chunk_seed=seed,segs=b.get('segs',1),pose=POSE)
    # rest the knuckles on the ground: lowest point at z = -.04, centred on the fist (not the forearm)
    zs=[v[2] for v in R.v]; zmin=min(zs)
    hand=[i for i in range(len(R.v)) if R.v[i][2]<zmin+.9]
    cx=sum(R.v[i][0] for i in hand)/len(hand); cy=sum(R.v[i][1] for i in hand)/len(hand)
    R.v=[(x-cx,y-cy,z-zmin-.04) for (x,y,z) in R.v]
    R.pivot=[(0.,0.,1.) for _ in R.v]
    return R.finish()

# UV-rasterized fissures supplement low vertex heat on rounded fist/boulder masses.
# Barycentric object positions keep widths metric and continuous over UV seams.
def heat_atlas(obs,res):
    heat=np.zeros((res,res),np.float32)
    # r18: the columns carry baked jagged forking crack networks (same language as the L1 shard / L3 boulder cracks).
    for variant,ob in enumerate(obs[:3]): column_crack_atlas(heat,ob,variant,res)
    # r18: the fist has no atlas cracks (board r17: the forearm fracture system read as a zigzag glyph/sigil).
    for ob in obs[3:5]:
        me=ob.data;uv=me.uv_layers['UVMap']; seeds=me.uv_layers['ChunkZI']
        fist=ob.name.endswith('fist')
        groups={}
        for poly in me.polygons:
            seed=round(seeds.data[poly.loop_start].uv.y)
            groups.setdefault(seed,[]).append(poly)
        for seed,polys in groups.items():
            coords=np.array([me.vertices[vi].co[:] for p in polys for vi in p.vertices]);lo=coords.min(axis=0);hi=coords.max(axis=0)
            for poly in polys:
                lis=list(poly.loop_indices);tri=[lis[0],lis[1],lis[2]]
                t=np.array([uv.data[li].uv[:] for li in tri])*res
                q=np.array([me.vertices[me.loops[li].vertex_index].co[:] for li in tri])
                x0,y0=np.maximum(0,np.floor(t.min(axis=0)).astype(int));x1,y1=np.minimum(res-1,np.ceil(t.max(axis=0)).astype(int))
                xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
                den=(t[1,1]-t[2,1])*(t[0,0]-t[2,0])+(t[2,0]-t[1,0])*(t[0,1]-t[2,1])
                if abs(den)<1e-8:continue
                a=((t[1,1]-t[2,1])*(xx-t[2,0])+(t[2,0]-t[1,0])*(yy-t[2,1]))/den
                b=((t[2,1]-t[0,1])*(xx-t[2,0])+(t[0,0]-t[2,0])*(yy-t[2,1]))/den;c=1-a-b
                inside=(a>=0)&(b>=0)&(c>=0)
                p=a[:,:,None]*q[0]+b[:,:,None]*q[1]+c[:,:,None]*q[2]
                p=(p-(lo+hi)/2)/np.maximum((hi-lo)/2,.01)
                x,y,z=p[:,:,0],p[:,:,1],p[:,:,2]
                segment=(z+1)*4;k=np.floor(segment);blend=segment-k
                path=.22*(np.sin(k*2.37+seed)*(1-blend)+np.sin((k+1)*2.37+seed)*blend)-.13
                width=.047*(.55+.45*np.sin(z*4+seed)**2)
                d=np.abs(x-path)
                fork=np.abs(x-path-(z-.05)*.70)
                fork2=np.abs(x-path+(z-.45)*.55)
                d=np.minimum(d,np.where((z>.05)&(z<.78),fork*1.25,10))
                d=np.minimum(d,np.where((z>-.6)&(z<.0),fork2*1.4,10))
                fade=np.clip((.92-np.abs(z))/.28,0,1)
                if fist:
                    fade=fade*np.clip((z+.05)/.30,0,1)*np.clip((y+1.1)/.5,0,1)   # keep the curled fingers clean
                    width=width*1.5
                    # second fracture system on the forearm facets (r17: cracks that light the mass)
                    d=np.minimum(d,np.where(z>.15,np.abs(x+.35-path*.5+(z-.5)*.9)*1.1,10))
                value=np.clip(1-d/width,0,1)**.65*fade*(.95 if fist else .92)
                patch=heat[y0:y1+1,x0:x1+1];patch[inside]=value[inside]
    return heat

obs=[column(i) for i in range(3)]+[loose_rock(),boulder(),fist()]
if GEOMETRY_ONLY:
    for ob in obs:
        meshutil.select_only([ob],ob)
        tris=sum(len(p.vertices)-2 for p in ob.data.polygons)
        out=os.path.join(OUTDIR,ob.name+'.glb')
        bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_normals=True,
            export_texcoords=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_materials='EXPORT')
        print('EARTH_R18_GEOMETRY',dict(name=ob.name,triangles=tris,chunks=ob['earthChunkCount']),flush=True)
    print('EARTH_C2_R18_GEOMETRY_COMPLETE',flush=True); sys.exit(0)
for ob in obs[:3]:
    for v in ob.data.vertices:v.co.x*=COLUMN_SCALE[0];v.co.y*=COLUMN_SCALE[1];v.co.z*=COLUMN_SCALE[2]
# UV islands are unwrapped per game mesh then assigned one stable tile in the shared normal/AO atlas.
for tile,ob in enumerate(obs):
    meshutil.select_only([ob],ob);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.1,island_margin=.003);bpy.ops.object.mode_set(mode='OBJECT')
    for uv in ob.data.uv_layers['UVMap'].data:
        uv.uv=( (tile%3+ .04+uv.uv.x*.92)/3, tile//3/2+.02+uv.uv.y*.92/3 )
# Bake from displaced subdivision sculpts, retaining original low topology and fracture metadata.
pipeline.setup_cycles(samples=8)
res=2048
normal=pipeline.new_image('basalt_normal',res,color=(.5,.5,1,1))
ao=pipeline.new_image('basalt_ao',res,color=(1,1,1,1))
albedo=pipeline.new_image('basalt_mineral',res,color=(.30,.30,.30,1))
normal.colorspace_settings.name='Non-Color';ao.colorspace_settings.name='Non-Color'
for ob in obs:
    for other in obs:other.hide_render=other!=ob
    hi=ob.copy();hi.data=ob.data.copy();bpy.context.collection.objects.link(hi);hi.name=ob.name+'_sculpt'
    meshutil.select_only([hi],hi)
    sub=hi.modifiers.new('sculpt resolution','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=3 if not RELEASE else 4
    bpy.ops.object.modifier_apply(modifier=sub.name)
    tex=bpy.data.textures.new(hi.name+'_chips',type='CLOUDS');tex.noise_scale=.035;tex.noise_depth=2
    dis=hi.modifiers.new('basalt micro chips','DISPLACE');dis.texture=tex;dis.strength=.006;dis.mid_level=.5
    bpy.ops.object.modifier_apply(modifier=dis.name)
    hi.hide_render=False
    mat=bpy.data.materials.new(hi.name+'_mineral');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
    out=nodes.new('ShaderNodeOutputMaterial');em=nodes.new('ShaderNodeEmission')
    coord=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=7;noise.inputs['Detail'].default_value=2.5
    links.new(coord.outputs['Position'] if 'Position' in coord.outputs else coord.outputs['Object'],noise.inputs['Vector'])
    # r17 pigment: cool blue-black basalt (board r16: the r16 warm-grey read as pale sandstone/cork next to the snowy
    # ground). Broad mineral patches; the baked micro-chip normal supplies the fine grain.
    ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.30;ramp.color_ramp.elements[0].color=(.115,.122,.140,1)
    ramp.color_ramp.elements[1].position=.72;ramp.color_ramp.elements[1].color=(.33,.345,.375,1)
    links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],em.inputs['Color']);links.new(em.outputs[0],out.inputs['Surface'])
    hi.data.materials.clear();hi.data.materials.append(mat)
    pipeline.bake_pass(ob,[hi],albedo,kind='EMIT',extrusion=.006,max_ray=.012,samples=1)
    pipeline.bake_pass(ob,[hi],normal,kind='NORMAL',extrusion=.006,max_ray=.012,samples=4)
    pipeline.bake_pass(ob,[hi],ao,kind='AO',extrusion=.006,max_ray=.012,samples=8)
    bpy.data.objects.remove(hi,do_unlink=True)
a= pipeline.image_np(ao);n=pipeline.image_np(normal)
print('BAKE_RANGE',float(n[:,:,:3].min()),float(n[:,:,:3].max()),float(np.std(n[:,:,0])),float(a[:,:,:3].min()),flush=True)
assert np.std(n[:,:,0])>.001 and a[:,:,:3].min()<.98,'Blank normal/AO bake rejected'
a[:,:,:3]=np.clip(a[:,:,:3],.15,1)
yy,xx=np.mgrid[0:res,0:res]
a[:,:,1]=np.clip(.88+.055*np.sin(xx*.13)*np.sin(yy*.17)+(1-a[:,:,0])*.07,.83,.99)
ao.pixels.foreach_set(a.ravel())
for image,name in [(normal,'magic_earth_normal.png'),(ao,'magic_earth_ao.png')]:
    image.filepath_raw=os.path.join(OUTDIR,name);image.file_format='PNG';image.save()
packed=pipeline.image_np(ao);packed[:,:,2]=heat_atlas(obs,res);ao.pixels.foreach_set(packed.ravel())
mask=np.max(np.abs(pipeline.image_np(normal)[:,:,:3]-np.array([.5,.5,1])),axis=2)>.001
for im,name in [(normal,'magic_earth_normal.png'),(ao,'magic_earth_ao.png'),(albedo,'magic_earth_basalt.png')]:
    arr=pipeline.image_np(im);valid=mask.copy()
    for _ in range(8):
        fresh=valid.copy()
        for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
            take=(~fresh)&np.roll(valid,(dy,dx),(0,1))
            arr[take]=np.roll(arr,(dy,dx),(0,1))[take];fresh|=take
        valid=fresh
    im.pixels.foreach_set(arr.ravel());im.filepath_raw=os.path.join(OUTDIR,name);im.file_format='PNG';im.save()
for ob in obs[:3]:
    for v in ob.data.vertices:v.co.x/=COLUMN_SCALE[0];v.co.y/=COLUMN_SCALE[1];v.co.z/=COLUMN_SCALE[2]
manifest=[]
for ob in obs:
    ob.hide_render=False;meshutil.select_only([ob],ob)
    tris=sum(len(p.vertices)-2 for p in ob.data.polygons)
    assert tris<16000,(ob.name,tris)
    out=os.path.join(OUTDIR,ob.name+'.glb')
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_normals=True,
        export_texcoords=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_materials='EXPORT')
    manifest.append(dict(name=ob.name,triangles=tris,chunks=ob['earthChunkCount'],bytes=os.path.getsize(out)))
    print('EARTH_R18_ASSET',manifest[-1],flush=True)
# Publish complete family only; failed Blender Python scripts sometimes return exit 0.
if '--no-publish' not in sys.argv:
    for ob in obs:shutil.copyfile(os.path.join(OUTDIR,ob.name+'.glb'),os.path.join(ROOT,'public/assets/models',ob.name+'.glb'))
    for name in ['magic_earth_normal.png','magic_earth_ao.png','magic_earth_basalt.png']:
        shutil.copyfile(os.path.join(OUTDIR,name),os.path.join(ROOT,'public/assets/textures',name))
with open(os.path.join(OUTDIR,'manifest.json'),'w') as f:json.dump(dict(release=RELEASE,assets=manifest),f,indent=2)
print('EARTH_C2_R18_FAMILY_COMPLETE',flush=True)
