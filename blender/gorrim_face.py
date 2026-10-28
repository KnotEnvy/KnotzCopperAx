"""Gorrim r25 face: donor-preserving lips, guide-shell locks and woven plaits.
Run only through tools/blender-run.mjs. No public assets or shared modules written.
"""
import argparse, json, math, os, struct, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import gorrim_team as T
import brann_face as BF
from lib import pipeline

CONFIG = dict(seed=2519, mouth_z=1.151, lip_width=.056, lip_upper_rgb=(151,87,65),
              lip_lower_rgb=(158,89,73), skin_rgb=(184,127,94),
              lock_groups=14, lock_widths=(.060,.044,.031,.018), strand_rgb=(163,64,24),
              crossings=8, braid_sides=8, braid_steps=49, ring_sides=24,
              tile_px=576, gutter_px=3, face_plate_retract=.014, face_plate_drop=.0025,
              face_chart_angle=65, face_chart_margin=.0025, run_uv_probe=False)
PART=os.path.join(T.PARTS_DIR,'face')
WORK=os.path.join(T.TEAM,'face')
START=time.time()

def log(s): print(f'[gorrim-face] stage {s} done in {time.time()-START:.1f}s',flush=True)
def unit(p): return p/np.maximum(np.linalg.norm(p,axis=-1,keepdims=True),1e-12)
def norm(P,F):
    n=np.cross(P[F[:,1]]-P[F[:,0]],P[F[:,2]]-P[F[:,0]])
    a=np.zeros_like(P)
    for j in range(3): np.add.at(a,F[:,j],n)
    return unit(a)[F]
def lightness(rgb):
    c=np.asarray(rgb); c=np.where(c>.04045,((c+.055)/1.055)**2.4,c/12.92)
    y=c@np.array([.2126,.7152,.0722]);return np.where(y>.008856,116*np.cbrt(y)-16,903.3*y)
def save_tile(name,albedo,orm=None,normal=None):
    h,w=albedo.shape[:2]
    if orm is None: orm=np.broadcast_to(np.array([1,.82,0]),(h,w,3)).copy()
    if normal is None:normal=np.broadcast_to(np.array([.5,.5,1]),(h,w,3)).copy()
    for k,a in [('albedo',albedo),('orm',orm),('normal',normal)]:
        pipeline.save_png(a,os.path.join(PART,'tiles',f'{name}_{k}.png'))

def face_uv(D,fidx):
    # Smart orthogonal charts eliminate the donor's crushed little mouth islands.
    ids=np.unique(D.F[fidx]);remap=np.full(len(D.P),-1);remap[ids]=np.arange(len(ids))
    positions,inv=np.unique(np.round(D.P[ids],7),axis=0,return_inverse=True)
    me=bpy.data.meshes.new('face_uv');me.from_pydata(positions,[],inv[remap[D.F[fidx]]]);me.update()
    ob=bpy.data.objects.new('face_uv',me);bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(CONFIG['face_chart_angle']),island_margin=.002,area_weight=0.,correct_aspect=False,scale_to_bounds=True)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True,rotate_method='ANY',scale=True,shape_method='CONCAVE',margin=CONFIG['face_chart_margin'])
    bpy.ops.object.mode_set(mode='OBJECT')
    uv=np.array([me.uv_layers.active.data[p.loop_start+j].uv[:] for p in me.polygons for j in range(3)]).reshape(-1,3,2)
    # Reserve a thin bottom strip for the lip overlays.
    uv[:, :, 0]=.008+uv[:,:,0]*.984;uv[:,:,1]=.055+uv[:,:,1]*.937
    bpy.data.objects.remove(ob,do_unlink=True)
    return uv

def build_face(D):
    fidx=D.faces('face')
    UV=face_uv(D,fidx)
    # Sink the old flat mouth-slot plate at the outer mouth corners, retaining lip support centrally.
    P=D.P.copy();x,y,z=P.T
    def ease(a,b,v):
        t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
    mask=ease(.028,.041,abs(x))*(1-ease(.061,.078,abs(x)))
    mask*=np.exp(-.5*((z-1.165)/.014)**2)*(1-ease(-.096,-.048,y))
    mask*=ease(1.129,1.140,z)*(1-ease(1.179,1.190,z))
    mask*=np.isin(np.arange(len(P)),D.verts_of('face'))
    mask[np.isin(D.pos_id,D.pinned_positions(['face','head_other']))]=0
    P[:,1]+=CONFIG['face_plate_retract']*mask;P[:,2]-=CONFIG['face_plate_drop']*mask
    moved=np.flatnonzero(np.linalg.norm(P-D.P,axis=1)>1e-8)
    N=D.NC[fidx].copy();affected=(np.linalg.norm(P-D.P,axis=1)[D.F[fidx]]>1e-8).any(1)
    if len(moved):N[affected]=BF.corner_normals(D,P)[fidx][affected]
    world,_,src,cov=BF.rasterize(D,P,fidx,UV,CONFIG)
    albedo=BF.sample_image(BF.read_image(os.path.join(T.DONOR_DIR,'gorrim_albedo.webp')),src)
    orm=BF.sample_image(BF.read_image(os.path.join(T.DONOR_DIR,'gorrim_orm.webp')),src)
    normal=BF.sample_image(BF.read_image(os.path.join(T.DONOR_DIR,'gorrim_normal.webp')),src)
    # Re-UV changes tangent frames: donor detail normals cannot be copied without rotation.
    # Keep the exact donor corner normals and use a neutral tangent map on the resampled face.
    normal[:]=[.5,.5,1]
    x,y,z=world.transpose(2,0,1)
    mouth=cov&(abs(x)<.058)&(z>1.127)&(z<1.178)
    # Completely replace the isolated black slot, including its baked AO.
    skin=np.array(CONFIG['skin_rgb'])/255
    albedo[mouth]=skin*(.96+.04*np.cos(x[mouth]*45))[:,None]
    orm[mouth]=[1,.80,0];normal[mouth]=[.5,.5,1]
    for k,arr in [('albedo',albedo),('orm',orm),('normal',normal)]:
        arr=pipeline.dilate(arr.astype(np.float32),cov,px=5)
        # Separate shallow lip-roll charts; upper is warm skin, lower is red-brown.
        arr[:27]=np.array([.5,.5,1]) if k=='normal' else np.array([1,.78,0]) if k=='orm' else skin
        if k=='albedo':
            arr[3:12]=np.array(CONFIG['lip_upper_rgb'])/255
            arr[16:26]=np.array(CONFIG['lip_lower_rgb'])/255
            arr[20:23]=np.array([172,106,88])/255
        pipeline.save_png(arr,os.path.join(PART,'tiles',f'face_{k}.png'))
    T.save_edits(PART,vidx=moved,P_new=P[moved],fidx=fidx,UV=UV,N=N,
                 meta=dict(role='face',tier='A',notes='Welded outer mouth-slot plate retraction; pinned seams retained; donor UV transfer, warm lips, neutral tangent normal.'))
    du,dv=UV[:,1]-UV[:,0],UV[:,2]-UV[:,0]
    a2=np.abs(du[:,0]*dv[:,1]-du[:,1]*dv[:,0]).sum()/2
    q=P[D.F[fidx]];area=np.linalg.norm(np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]),axis=1).sum()*.5;density=np.sqrt(a2/area)*576
    return dict(face_moved_vertices=int(len(moved)),face_plate_max_delta_mm=float(np.linalg.norm(P-D.P,axis=1).max()*1000),face_density_px_m=float(density),face_density_x_body=float(density/D.texel_density(['body'])[0]),
                mouth_darkest_wide_Lstar=float(lightness(albedo[mouth]).min()))

class Mesh:
    def __init__(self):self.p=[];self.f=[];self.uv=[];self.head=[]
    def add(self,P,F,UV,head=False):
        offset=len(self.p);self.p.extend(np.asarray(P).tolist());self.f.extend((np.asarray(F)+offset).tolist());self.uv.extend(UV);self.head.extend([head]*len(P))
    def arrays(self):return np.array(self.p,float),np.array(self.f,int),np.array(self.uv,float)
    def save(self,D,name,tile,replaces,notes):
        P,F,UV=self.arrays()
        if name=='beard':
            ax=abs(P[:,0]);P[:,0]=np.sign(P[:,0])*(np.minimum(ax,.100)+np.maximum(ax-.100,0)*.65)
            assert P[:,1].max()<=.015, 'beard root escaped behind the donor face'
            assert abs(P[:,0]).max()<=.122 and P[:,1].min()>=-.242, 'beard footprint exceeded'
        W,bones=T.transfer_weights(P,D,regions=('beard',) if name in ('beard','rings') else ('face','brows'),bones=['head','beard_1','beard_2','beard_3'] if name in ('beard','rings') else ['head'])
        force=np.array(self.head)|(P[:,2]>1.125)
        W[force]=0;W[force,bones.index('head')]=1
        T.save_part(PART,name,P=P,F=F,UV=UV,N=norm(P,F),W=W,bones=bones,tile=tile,
                    meta=dict(role='face',replaces=replaces,notes=notes))
        return len(F)

def guide(points,n=23):
    # Cubic Bezier for four controls, otherwise smooth Catmull-Rom interpolation.
    p=np.array(points,float);t=np.linspace(0,1,n)
    if len(p)==4:return (1-t[:,None])**3*p[0]+3*(1-t[:,None])**2*t[:,None]*p[1]+3*(1-t[:,None])*t[:,None]**2*p[2]+t[:,None]**3*p[3]
    q=t*(len(p)-1);i=np.minimum(q.astype(int),len(p)-2);s=(q-i)[:,None]
    a=p[np.maximum(i-1,0)];b=p[i];c=p[i+1];d=p[np.minimum(i+2,len(p)-1)]
    return .5*((2*b)+(-a+c)*s+(2*a-5*b+4*c-d)*s*s+(-a+3*b-3*c+d)*s**3)

def tube(M,path,width,depth,uvbox=(.025,.08,.975,.95),sides=10,head=False,taper=True,caps=True,root_donor=None,root_ramp=False):
    C=np.asarray(path);n=len(C);t=np.linspace(0,1,n)
    tang=unit(np.gradient(C,axis=0));out=np.tile([0.,-1.,0.],(n,1));out=unit(out-tang*(out*tang).sum(1)[:,None]);side=unit(np.cross(tang,out))
    # Lens ellipse: locks are flat across the flow, never round tentacles.
    fac=(.78+.22*np.sin(t*math.pi))*(1-.96*t**2.5) if taper else np.ones(n)
    if root_ramp:
        r=np.clip(t/.20,0,1);fac*=.14+.86*r*r*(3-2*r)
    a=np.linspace(0,math.tau,sides,endpoint=False)
    P=C[:,None,:]+side[:,None,:]*np.cos(a)[None,:,None]*(width*.5*fac)[:,None,None]+out[:,None,:]*np.sin(a)[None,:,None]*(depth*.5*fac)[:,None,None]
    if root_donor is not None:
        from mathutils import Vector
        fitted_root(root_donor,float(C[0,0]),float(C[0,2]))
        for row,blend in [(0,1.),(1,1.),(2,.35)]:
          for j in range(sides):
            p=P[row,j];loc,normal,_,_=fitted_root.bvh.ray_cast(Vector((float(p[0]),-.5,float(p[2]))),Vector((0,1,0)))
            if loc is None:loc,normal,_,_=fitted_root.bvh.find_nearest(Vector(p))
            if loc is not None:
                target=np.array(loc)-np.array(normal)*.006
                a=math.tau*j/sides
                target+=np.array([math.cos(a),0,math.sin(a)])*(.0002+.0001*row)
                delta=target-p
                P[row,j]+=delta*blend
    P=P.reshape(-1,3);F=[];UV=[];u0,v0,u1,v1=uvbox
    for i in range(n-1):
      for j in range(sides):
        k=(j+1)%sides
        for tri,uv in [([i*sides+j,i*sides+k,(i+1)*sides+k],[(j/sides,i/(n-1)),((j+1)/sides,i/(n-1)),((j+1)/sides,(i+1)/(n-1))]),([i*sides+j,(i+1)*sides+k,(i+1)*sides+j],[(j/sides,i/(n-1)),((j+1)/sides,(i+1)/(n-1)),(j/sides,(i+1)/(n-1))])]:
          F.append(tri);UV.append([[u0+u*(u1-u0),v1-v*(v1-v0)] for u,v in uv])
    # Caps anchored to the same section, not floating discs.
    for i,flip in ([(0,True),(n-1,False)] if caps else []):
      for j in range(1,sides-1):
        F.append([i*sides,i*sides+j+1,i*sides+j] if flip else [i*sides,i*sides+j,i*sides+j+1]);UV.append([[u0,v1]]*3)
    F=np.array(F);q=P[F];vol=np.sum(np.einsum('ij,ij->i',q[:,0],np.cross(q[:,1],q[:,2])))/6
    if vol<0:F=F[:,::-1];UV=np.array(UV)[:,::-1]
    M.add(P,F,UV,head)

def build_face_extra(D):
    m=Mesh();x=np.linspace(-.028,.028,25);f=np.sqrt(np.maximum(0,1-(x/.029)**2))
    # Full lip rolls partly inset into the donor surface; their front follows its shallow cup.
    for z,height,band in [(1.1545,.0042,(.08,.007,.92,.020)),(1.1475,.0060,(.08,.028,.92,.043))]:
        path=np.stack([x,-.0955+.012*(x/.029)**2,np.full_like(x,z)-.001*(x/.029)**2],1)
        tube(m,path,.009,.007,uvbox=band,sides=10,head=True,taper=False,caps=False)
    return m.save(D,'face_extra','face',[],'Upper and full lower lip rolls under the moustache; buried inside donor face; head only.')


def groom_tile(name,w,h,rgb):
    y,x=np.mgrid[0:h,0:w];u=x/w;v=y/h
    # Longitudinal grooves and broad clump shadows; no isotropic SDF noise.
    phase=u*math.tau*82+.75*np.sin(v*6+u*7)+.22*np.sin(v*23+u*17)
    fine=.055*np.sin(phase)+.025*np.sin(phase*2.31)
    broad=.09*np.sin(u*math.tau*7+.5*np.sin(v*5))
    root=.74+.26*np.minimum(1,(1-v)*6)
    value=np.clip(root+fine+broad,.54,1.16)
    if name=='beard':value*=np.array([.76,.93,1.04,.85])[np.minimum((u*4).astype(int),3)]
    albedo=np.array(rgb)[None,None,:]/255*value[...,None]
    orm=np.zeros_like(albedo)+[1,.84,0];orm[...,1]+=.04*np.sin(phase)
    normal=np.zeros_like(albedo)+[.5,.5,1];normal[...,0]=.5+.055*np.cos(phase)
    save_tile(name,albedo,orm,normal)

def hidden_support(M,D):
    # A smooth fitted under-volume; the donor voxel clumps are deliberately discarded.
    nx,nt=23,11;u=np.linspace(-1,1,nx);t=np.linspace(0,1,nt)
    P=[]
    for layer in (0,1):
      for v in t:
        for q in u:
          ax=abs(q);rz=1.141+.034*ax**1.3;bz=.991+.024*ax
          x=q*(.106*(1-v)+.098*v)
          ry=-.092+.065*ax**1.7;by=-.217+.012*ax
          y=ry*(1-v)+by*v+.008*math.sin(v*math.pi)+layer*.022
          P.append([x,y,rz*(1-v)+bz*v])
    F=[];offset=nx*nt
    for layer in (0,1):
      for i in range(nt-1):
       for j in range(nx-1):
        a=layer*offset+i*nx+j;b=a+1;c=a+nx;d=c+1
        F.extend([[a,c,d],[a,d,b]] if layer==0 else [[a,d,c],[a,b,d]])
    perimeter=list(range(nx))+[i*nx+nx-1 for i in range(1,nt)]+list(range((nt-1)*nx+nx-2,(nt-1)*nx-1,-1))+[i*nx for i in range(nt-2,0,-1)]
    for j,a in enumerate(perimeter):
      b=perimeter[(j+1)%len(perimeter)];F.extend([[a,b,b+offset],[a,b+offset,a+offset]])
    P=np.array(P);F=np.array(F);UV=np.zeros((len(F),3,2))+[.012,.988]
    q=P[F]
    if np.einsum('ij,ij->i',q[:,0],np.cross(q[:,1],q[:,2])).sum()<0:F=F[:,::-1]
    base_uv=np.array([[.012+(i%nx)/(nx-1)*.21,.94-((i%offset)//nx)/(nt-1)*.84] for i in range(len(P))]);UV=base_uv[F]
    M.add(P,F,UV);return len(F)


def fitted_root(D,x,z):
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    if not hasattr(fitted_root,'bvh'):
        fitted_root.bvh=BVHTree.FromPolygons([Vector(p) for p in D.P],D.F[D.faces('face')].tolist(),all_triangles=True)
    loc,_,_,_=fitted_root.bvh.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))
    if loc is None:
        loc,normal,_,_=fitted_root.bvh.find_nearest(Vector((x,-.07,z)));return (np.array(loc)-np.array(normal)*.003).tolist()
    return [x,float(loc.y)+.003,z]

def braid_path(x,top,bottom,n=49):
    t=np.linspace(0,1,n)
    return np.stack([x*(1+.06*t),-.214-.009*t,top+(bottom-top)*t],1)

def build_rings(D,specs):
    M=Mesh();w,h=608,1392;y,x=np.mgrid[0:h,0:w];u=x/w;v=y/h
    # Two interlaced sine bands give a continuous brass knot, with tangent-space relief.
    q=np.minimum(abs(v-.5-.22*np.sin(u*math.tau*4)),abs(v-.5+.22*np.sin(u*math.tau*4)))
    knot=np.exp(-(q/.025)**2);edge=np.exp(-((v-.08)/.018)**2)+np.exp(-((v-.92)/.018)**2)
    albedo=np.zeros((h,w,3))+np.array([178,126,48])/255
    albedo+=(knot*.20+edge*.16)[...,None]*np.array([1,.85,.42])
    orm=np.zeros_like(albedo)+[1,.38,.86]
    normal=np.zeros_like(albedo)+[.5,.5,1];height=knot+edge
    dy,dx=np.gradient(height);normal[...,0]-=np.clip(dx*8,-.20,.20);normal[...,1]-=np.clip(dy*8,-.20,.20)
    save_tile('rings',albedo,orm,normal)
    for cx,cy,cz,r in specs:
        # Bevelled oval cuff, embedded into the moving three-strand plait, no air gap.
        n=24;a=np.arange(n)/n*math.tau;P=[]
        levels=[(-.010,r*.91),(-.007,r),(.007,r),(.010,r*.91)]
        for dz,rr in levels:
            P.extend(np.stack([cx+np.cos(a)*rr,cy+np.sin(a)*rr*.67,np.full(n,cz+dz)],1))
        F=[];uv=[]
        for k in range(3):
          for j in range(n):
            jj=(j+1)%n
            for tri,coords in [([k*n+j,k*n+jj,(k+1)*n+jj],[(j/n,k/3),((j+1)/n,k/3),((j+1)/n,(k+1)/3)]),([k*n+j,(k+1)*n+jj,(k+1)*n+j],[(j/n,k/3),((j+1)/n,(k+1)/3),(j/n,(k+1)/3)])]:
                F.append(tri);uv.append([[.02+u*.96,.02+v*.96] for u,v in coords])
        M.add(P,F,uv)
    return M.save(D,'rings','rings',[],'Three bevelled brass knot cuffs, seated on the plaits; donor beard weights.')


def moustache_bridge(M):
    # A closed rounded centre mass has no exposed tube end in the profile view.
    sides,rows=16,8;center=np.array([0.,-.106,1.1675]);scale=np.array([.016,.0055,.0075])
    P=[center+[0,0,scale[2]]]
    for r in range(1,rows):
      theta=math.pi*r/rows
      for j in range(sides):
        a=math.tau*j/sides;P.append(center+scale*np.array([math.sin(theta)*math.cos(a),math.sin(theta)*math.sin(a),math.cos(theta)]))
    bottom=len(P);P.append(center-[0,0,scale[2]]);F=[];UV=[]
    def uv(u,v):return [.514+u*.222,.10+v*.84]
    for j in range(sides):
      k=(j+1)%sides;F.append([0,1+j,1+k]);UV.append([uv((j+.5)/sides,1),uv(j/sides,1-1/rows),uv((j+1)/sides,1-1/rows)])
    for r in range(rows-2):
      for j in range(sides):
        k=(j+1)%sides;a=1+r*sides+j;b=1+r*sides+k;c=a+sides;d=b+sides
        F.extend([[a,c,d],[a,d,b]])
        u,v=j/sides,1-(r+1)/rows;un,vn=(j+1)/sides,1-(r+2)/rows
        UV.extend([[uv(u,v),uv(u,vn),uv(un,vn)],[uv(u,v),uv(un,vn),uv(un,v)]])
    base=1+(rows-2)*sides
    for j in range(sides):
      k=(j+1)%sides;F.append([base+j,bottom,base+k]);UV.append([uv(j/sides,1/rows),uv((j+.5)/sides,0),uv((j+1)/sides,1/rows)])
    P=np.array(P);F=np.array(F);UV=np.array(UV);q=P[F]
    if np.einsum('ij,ij->i',q[:,0],np.cross(q[:,1],q[:,2])).sum()<0:F=F[:,::-1];UV=UV[:,::-1]
    M.add(P,F,UV,head=True)

def build_beard(D):
    M=Mesh();support=hidden_support(M,D)
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    support_bvh=BVHTree.FromPolygons([Vector(p) for p in M.p],M.f,all_triangles=True)
    groom_tile('beard',1408,2048,CONFIG['strand_rgb'])
    # Seven guide groups on each side: broad jaw locks, short cheek overlays, narrow breakups.
    widths=[.060,.049,.039,.030,.018,.026,.033]
    for side in (-1,1):
      for i,width in enumerate(widths):
        x0=[.097,.081,.061,.040,.012,.089,.053][i]
        z0=[1.177,1.166,1.161,1.141,1.142,1.178,1.152][i]
        root=np.array(fitted_root(D,side*x0,z0))
        endx=side*[.051,.082,.020,.070,.008,.062,.030][i]
        endz=[1.014,1.008,1.001,1.027,.991,1.091,1.078][i]
        front=[-.187,-.204,-.216,-.224,-.225,-.157,-.202][i]
        # Short overlays run diagonally across the longer locks; ends are staggered.
        path=guide([root,[side*(x0+.014),root[1]-.028,z0-.028],
                    [side*(abs(endx)+.020),front+.008,endz+.034],[endx,front,endz]],n=15)
        # Guide cards sit on the smooth under-volume, instead of floating like tusks in profile.
        for j in range(2,len(path)):
            loc,_,_,_=support_bvh.ray_cast(Vector((float(path[j,0]),-.5,float(path[j,2]))),Vector((0,1,0)))
            if loc is not None:path[j,1]=float(loc.y)-(.008 if i>=5 else .005)
        tube(M,path,width,.012 if i<5 else .009,sides=8,uvbox=(i%4*.25+.014,.10,(i%4+1)*.25-.014,.94),root_donor=D)
    # Two moustache lobes share a solid centre under the nose; tips finish below the mouth corners.
    for side in (-1,1):
        root=fitted_root(D,side*.001,1.172)
        path=guide([root,[side*.026,-.104,1.166],[side*.062,-.109,1.144],[side*.084,-.112,1.133]],n=22)
        tube(M,path,.034,.010,sides=10,head=True,uvbox=(.514,.10,.736,.94),root_ramp=True)
    moustache_bridge(M)
    ring_specs=[]
    for x,top,end,radius in [(0.,1.035,.791,.022),(-.078,1.060,.862,.020),(.078,1.060,.862,.020)]:
        bottom=end+.040;C=braid_path(x,top,bottom,49);t=np.linspace(0,1,49)
        loc,_,_,_=support_bvh.ray_cast(Vector((x,-.5,top)),Vector((0,1,0)))
        if loc is not None:
            f=np.clip(t/.35,0,1);f=f*f*(3-2*f);start=float(loc.y)-.004;C[:,1]=start*(1-f)+(-.220-.003*t)*f
        R=radius*(1-.22*t)
        # Woven plait, not a helix: front/back switches twice per lateral cycle.
        for strand in range(3):
            ph=math.tau*4*t+math.tau*strand/3
            Q=C.copy();Q[:,0]+=R*.48*np.sin(ph);Q[:,1]-=R*.28*np.sin(2*ph)
            tube(M,Q,R*.85,R*.57,sides=8,taper=False,uvbox=(.264,.10,.486,.94))
        k=34;ring_specs.append((*C[k],float(R[k]*.94)))
        # Tuft flares below the cuff and then separates into three tapered, flattened tips.
        for j in range(3):
            root=C[35]+np.array([(j-1)*.007,0,.003]);tip=np.array([x+(j-1)*.009,-.224,end+.007*abs(j-1)])
            path=guide([root,root+[0,-.001,-.018],tip+[0,0,.012],tip],n=9)
            tube(M,path,.022,.010,sides=6)
    n=M.save(D,'beard','beard',['beard'],'Hidden smooth fitted support; 14 varied lens-section guide locks; two continuous moustache lobes; three eight-crossing woven plaits and flared tufts. Stacked strand UVs intentional.')
    nr=build_rings(D,ring_specs)
    return dict(beard=n,rings=nr,hidden_support_tris=support,lock_groups=14,width_ratio=max(widths)/min(widths),plait_crossings=8)

def build_brows(D):
    M=Mesh();groom_tile('brows',608,608,(119,43,17))
    for side in (-1,1):
      for j in range(3):
        root=fitted_root(D,side*(.015+j*.013),1.246+j*.002)
        path=guide([root,[side*(.027+j*.013),-.090+j*.001,1.252+j*.003],
                    [side*(.044+j*.009),-.086+j*.001,1.260+j*.001],
                    [side*(.054+j*.006),-.074+j*.001,1.263-j*.001]],n=8)
        tube(M,path,.014-j*.002,.006,sides=6,head=True)
    return M.save(D,'brows','brows',['brows'],'Two separated outward-sweeping tapered copper tufts, bare glabella; head only.')


def probe_face_packing(D):
    """Read-only proxy UV experiment; never changes the chosen parts or preview."""
    fidx=D.faces('face');ids=np.unique(D.F[fidx]);rm=np.full(len(D.P),-1);rm[ids]=np.arange(len(ids))
    P=D.P[ids];F=rm[D.F[fidx]];results=[];best=None
    area=D.texel_density(['face'])[1]
    for weld in (False,True):
      for angle in (50,65,80):
        pp,ff=P,F
        if weld:
            pp,iv=np.unique(np.round(P,7),axis=0,return_inverse=True);ff=iv[F]
        me=bpy.data.meshes.new('uv_probe');me.from_pydata(pp,[],ff);me.update()
        ob=bpy.data.objects.new('uv_probe',me);bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=ob;ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle),island_margin=.002,area_weight=0.,correct_aspect=False,scale_to_bounds=True)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=True,rotate_method='ANY',scale=True,shape_method='CONCAVE',margin=.0015)
        bpy.ops.object.mode_set(mode='OBJECT')
        uv=np.array([me.uv_layers.active.data[p.loop_start+j].uv[:] for p in me.polygons for j in range(3)]).reshape(-1,3,2)
        uv[:,:,0]=.008+uv[:,:,0]*.984;uv[:,:,1]=.055+uv[:,:,1]*.937
        u,v=uv[:,1]-uv[:,0],uv[:,2]-uv[:,0];a2=abs(u[:,0]*v[:,1]-u[:,1]*v[:,0])*.5
        q=D.P[D.F[fidx]];a3=np.linalg.norm(np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]),axis=1)*.5
        rho=np.sqrt(a2/np.maximum(a3,1e-12))*576;med=np.median(rho[rho>0]);bad=(rho<med*.25)|(rho>med*4)
        density=float(np.sqrt(a2.sum()/area)*576)
        r=dict(weld=weld,angle=angle,density_px_m=density,density_x_body=density/D.texel_density(['body'])[0],bad_fraction=float(bad.mean()),p01_density=float(np.percentile(rho,1)))
        results.append(r)
        if not bad.any() and (best is None or density>best[0]):best=(density,uv,r)
        bpy.data.objects.remove(ob,do_unlink=True)
    T.save_json(os.path.join(WORK,'uv_probe.json'),results)
    if best is not None:np.savez_compressed(os.path.join(WORK,'uv_probe_best.npz'),fidx=fidx,UV=best[1]);T.save_json(os.path.join(WORK,'uv_probe_best.json'),best[2])
    log('read-only face packing probe')

CT={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8};NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def _read_export_buffers(path):
 raw=bytearray(open(path,'rb').read());n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n]);start=28+n
 def acc(i):
  a=g['accessors'][i];b=g['bufferViews'][a['bufferView']];dt=CT[a['componentType']];nc=NC[a['type']];o=start+b.get('byteOffset',0)+a.get('byteOffset',0);stride=b.get('byteStride',np.dtype(dt).itemsize*nc)
  return np.ndarray((a['count'],nc),dtype=dt,buffer=raw,offset=o,strides=(stride,np.dtype(dt).itemsize))
 return raw,g,acc
def restore_donor_export(path):
 donor,gd,da= _read_export_buffers(T.DONOR_GLB);raw,g,acc= _read_export_buffers(path)
 dp=gd['meshes'][0]['primitives'][0]['attributes'];P,U=da(dp['POSITION']),da(dp['TEXCOORD_0'])
 oldbones=[gd['nodes'][j]['name'] for j in gd['skins'][0]['joints']];bones=[g['nodes'][j]['name'] for j in g['skins'][0]['joints']]
 lookup={}
 for i,k in enumerate(np.round(np.c_[P,U],6)):
  lookup.setdefault(tuple(k),[]).append(i)
 done=0
 for me in g['meshes']:
  for pr in me['primitives']:
   if g['materials'][pr.get('material',0)]['name']!='M_hero_gorrim':continue
   at=pr['attributes'];outP,outU,outN=acc(at['POSITION']),acc(at['TEXCOORD_0']),acc(at['NORMAL']);idx=[]
   for i,k in enumerate(np.round(np.c_[outP,outU],6)):
    candidates=lookup.get(tuple(k))
    if not candidates:raise RuntimeError('unmatched retained donor vertex '+str(k))
    idx.append(min(candidates,key=lambda j:np.linalg.norm(da(dp['NORMAL'])[j]-outN[i])))
   idx=np.array(idx,int)
   for key in ('NORMAL','TANGENT','JOINTS_0','WEIGHTS_0'):
    if key not in at or key not in dp:continue
    values=da(dp[key])[idx].copy()
    if key=='JOINTS_0':values=np.array([bones.index(oldbones[j]) for j in values.ravel()]).reshape(values.shape)
    acc(at[key])[:]=values
   done+=len(idx)
 with open(path,'wb') as f:f.write(raw)
 report={'restored_donor_vertices':done,'attributes':['NORMAL','TANGENT','JOINTS_0','WEIGHTS_0'],'method':'P+UV identity, named joint remap; donor source accessor values copied after Blender export'}
 T.save_json(os.path.join(os.path.dirname(path),'restored_donor.json'),report)
 return report


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--qa-out');ap.add_argument('--preview-out');ap.add_argument('--mouth-only',action='store_true');ap.add_argument('--preview',action='store_true');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    os.makedirs(PART,exist_ok=True);bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    D=T.Donor();report=build_face(D);log('face UV and slot repaint')
    report['face_extra']=build_face_extra(D);log('lip rolls')
    if not args.mouth_only:
        report.update(build_beard(D));report['brows']=build_brows(D);log('beard and brows')
    report['audit']=T.audit_role(PART);T.save_json(os.path.join(WORK,'build_report.json'),report);print(json.dumps(report),flush=True)
    if args.preview_out:
        import build_hero_gorrim_team as assembler
        sys.argv=['gorrim-face','--','--preview-role','face','--out',args.preview_out];assembler.main()
        print(restore_donor_export(os.path.join(args.preview_out,'hero_gorrim.glb')),flush=True)
        if not args.mouth_only and CONFIG['run_uv_probe']:probe_face_packing(D)
        if args.qa_out:
            import runpy
            sys.argv=['qa_model','--','--glb',os.path.join(args.preview_out,'hero_gorrim.glb'),'--out',args.qa_out]
            runpy.run_path(os.path.join(T.ROOT,'.claude','skills','kca-model-builder','scripts','qa_model.py'),run_name='__main__')
if __name__=='__main__':main()
