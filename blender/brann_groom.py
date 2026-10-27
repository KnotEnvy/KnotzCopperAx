"""Brann r18: closed, tapered swept locks and a continuous directional wolf pelt.

No voxel hair: explicit strand-group shells preserve gaps and pointed silhouettes.
All meshes bake into Brann's existing 2048 atlas; no alpha or extra runtime material.
"""
import math
import numpy as np
import bpy
import bmesh
from lib import meshutil, skin, shaders, pipeline
from lib.sdf import V, norm


def curve(points, n):
    """Centripetal-looking, endpoint-clamped Catmull-Rom samples."""
    P = np.asarray(points, float)
    out = []
    for t in np.linspace(0, len(P) - 1, n):
        i = min(int(t), len(P) - 2)
        f = t - i
        a, b, c, d = P[max(i-1, 0)], P[i], P[i+1], P[min(i+2, len(P)-1)]
        out.append(.5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f))
    return np.asarray(out)


class Shells:
    def __init__(self):
        self.v, self.f, self.along, self.lateral, self.ids = [], [], [], [], []

    def lock(self, points, width, thick, outward, lid, rings=28, sides=12, taper=.62):
        P = curve(points, rings+1)
        off = len(self.v)
        for i, p in enumerate(P[:-1]):
            t = i/rings
            T = norm(P[min(i+1, rings)]-P[max(i-1, 0)])
            N = norm(np.asarray(outward(t)))
            N = norm(N-T*np.dot(N,T))
            U = norm(np.cross(T,N))
            root = min(t/.12,1); root=root*root*(3-2*root)
            shape = (.18+.82*root) * max(.035, 1-(max(0,t-taper)/(1-taper))**1.1)
            for j in range(sides):
                a = j/sides*2*math.pi
                # Small strand-group ridges, rather than deep carved longitudinal slots.
                ridge = 1+.035*math.cos(a*4+t*5+lid)
                q=p+U*math.cos(a)*width*shape+N*math.sin(a)*thick*shape*ridge
                self.v.append(q); self.along.append(t); self.lateral.append(math.cos(a)); self.ids.append(lid)
        for i in range(rings-1):
            for j in range(sides):
                a=off+i*sides+j; b=off+i*sides+(j+1)%sides
                self.f.extend([(a,b,b+sides),(a,b+sides,a+sides)])
        root=len(self.v); self.v.append(P[0]); self.along.append(0); self.lateral.append(0); self.ids.append(lid)
        tip=len(self.v); self.v.append(P[-1]); self.along.append(1); self.lateral.append(0); self.ids.append(lid)
        for j in range(sides):
            self.f.append((root,off+(j+1)%sides,off+j))
            self.f.append((tip,off+(rings-1)*sides+j,off+(rings-1)*sides+(j+1)%sides))

    def object(self,name):
        ob=meshutil.mesh_from_numpy(name,np.asarray(self.v),np.empty((0,4),int),np.asarray(self.f))
        bm=bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
        for k,a in [('along',self.along),('lateral',self.lateral),('lock_id',self.ids)]:
            meshutil.add_float_attr(ob,k,np.asarray(a,np.float32))
        for p in ob.data.polygons: p.use_smooth=True
        return ob


def mane(H, name='mane_lo'):
    B=Shells()
    # Seven lifted crown locks. Unequal paths and lengths leave real shadow gaps.
    for i,x in enumerate(np.linspace(-.078,.078,7)):
        edge=abs(x)/.078
        side=1 if x>=0 else -1
        pts=[H(x,-.075+edge*.038,.052-edge*.02),
             H(x*1.10,-.027,.120-edge*.024+(i%2)*.007),
             H(x*1.24,.064,.118-edge*.033+(i%3)*.006),
             H(x*1.50,.140+(i%2)*.009,.012-edge*.018),
             H(x*1.8+side*.012,.175+(i%3)*.009,-.135-(i%3)*.012),
             H(x*2.05+side*.018,.190+(i%2)*.024,-.253-(i%3)*.030),
             H(x*1.7+side*.018,.170+(i%3)*.020,-.335-(i%3)*.043)]
        B.lock(pts,(.036 if i%2 else .042)*H.s,.0075*H.s,
               lambda t:V(0,.16+t,1-t*1.5),i,rings=34,sides=14,taper=.32)
    # Temple locks start behind the brow, sweep around exposed ears, then fall behind the shoulder.
    for sx in (-1,1):
        for j in range(2):
            pts=[H(sx*(.069+j*.006),-.036+j*.022,.037-j*.02),
                 H(sx*(.100+j*.008),.011,.063-j*.035),
                 H(sx*(.109+j*.012),.072,-.013-j*.044),
                 H(sx*(.135+j*.009),.106,-.151-j*.028),
                 H(sx*(.167-j*.013),.132,-.29-j*.067),
                 H(sx*(.158+j*.014),.154,-.373-j*.070)]
            B.lock(pts,(.034+j*.006)*H.s,.007*H.s,lambda t,s=sx:V(s*.8,.5+t,.2-t*.4),7+(sx+1)+j,rings=30,sides=12,taper=.34)
    # Lower nape lock closes the back without fusing the crown into a wax slab.
    B.lock([H(0,.108,-.045),H(.009,.148,-.12),H(-.012,.167,-.26),H(.012,.195,-.437)],
           .065*H.s,.007*H.s,lambda t:V(0,1,0),11,rings=28,sides=12,taper=.38)
    return B.object(name)


def pauldrons(L, S=None):
    out={}
    for si,side in enumerate(('L','R')):
        B=Shells(); rng=np.random.RandomState(180+si)
        shoulder=L['shoulder_'+side]; d=norm(L['elbow_'+side]-shoulder)
        back=V(0,1,0); up=norm(np.cross(d,back))
        if up[2]<0: up=-up
        # A closed continuous under-pelt, with staggered overlapping tapered locks on top.
        # Long axis follows the upper arm. Root rows sit at the shoulder crown.
        c=shoulder+d*.014
        nr,ns=12,24
        for i in range(1,nr):
            a=math.pi*i/nr
            for j in range(ns):
                b=2*math.pi*j/ns
                p=c+d*(math.cos(a)*.114)+(up*math.cos(b)*.122+back*math.sin(b)*.113)*math.sin(a)
                B.v.append(p); B.along.append(.12); B.lateral.append(0); B.ids.append(20)
        for i in range(nr-2):
            for j in range(ns):
                a=i*ns+j; b=i*ns+(j+1)%ns; B.f.extend([(a,b,b+ns),(a,b+ns,a+ns)])
        poles=np.array([c+d*.114,c-d*.114])
        p0=len(B.v); B.v.extend(poles); B.along.extend([.1,.1]); B.lateral.extend([0,0]); B.ids.extend([20,20])
        if S is not None:
            P=np.array(B.v);Q=S.project(P,offset=.012);D=Q-P
            D*=np.minimum(1,.035/np.maximum(np.linalg.norm(D,axis=1,keepdims=True),1e-8))
            B.v=list(P+D)
        for j in range(ns):
            B.f.extend([(p0,j,(j+1)%ns),(p0+1,(nr-2)*ns+(j+1)%ns,(nr-2)*ns+j)])
        for row in range(4):
            # Exclude the hidden armpit quadrant; silhouette is long, down/back, irregular.
            for j in range(20):
                a=(-.32+row*.18)+rng.uniform(-.045,.045)
                b=(-1.9+j/19*3.8)+(row%2)*.09
                normal=norm(up*math.cos(b)+back*math.sin(b))
                root=c+d*a*.14+normal*(.111-.013*abs(a))
                if S is not None:
                    delta=S.project(root[None],offset=.020)[0]-root
                    root+=delta*min(1,.035/max(np.linalg.norm(delta),1e-8))
                flow=norm(d*.85+back*.40+normal*.10)
                ln=rng.uniform(.072,.096)*(1+.06*row)
                pts=[root-normal*.005,root+flow*ln*.30+normal*.011,
                     root+flow*ln*.70+normal*.014,root+flow*ln+normal*.003]
                B.lock(pts,rng.uniform(.014,.020),rng.uniform(.0035,.0050),lambda t,n=normal:n,
                       21+row*20+j,rings=7,sides=8,taper=.32)
        out[side]=B.object('pauldron_lo_'+side)
    return out


def bind_pelts(pelts,arm,L):
    for side,ob in pelts.items():
        # Smooth clavicle->upperarm blend only at the medial root; outer drape follows the arm.
        d=norm(L['elbow_'+side]-L['shoulder_'+side])
        P=meshutil.get_verts(ob)
        a=np.clip(((P-L['shoulder_'+side])@d+.065)/.105,0,1)
        a=a*a*(3-2*a)
        names=['clavicle_'+side,'upperarm_'+side]
        skin.write_groups(ob,names,np.stack([1-a,a],axis=1))
        mod=ob.modifiers.new('Armature','ARMATURE'); mod.object=arm
        ob.parent=arm


def shared_strip_uv(ob, box):
    """Reuse a coherent strand strip across locks, avoiding hundreds of padded micro-islands.

    Opposite sides share the same longitudinal paint. Sources and game shells are
    identical, so the baked tangent normal remains flat on either side.
    """
    me=ob.data
    along=np.empty(len(me.vertices),np.float32);me.attributes['along'].data.foreach_get('value',along)
    lat=np.empty(len(me.vertices),np.float32);me.attributes['lateral'].data.foreach_get('value',lat)
    lv=np.empty(len(me.loops),np.int32);me.loops.foreach_get('vertex_index',lv)
    x0,y0,x1,y1=box
    UV=np.stack([x0+(lat[lv]+1)*.5*(x1-x0),y0+along[lv]*(y1-y0)],axis=1)
    uv=me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv',UV.astype(np.float32).ravel())


def strand_tiles(rgb, orm, normal, pal):
    """Full texel-resolution fibres; vertex colours alone cannot resolve fine strands.

    Hair/fur share longitudinal strips within the existing atlas. Small tangent
    relief and matte roughness keep individual fibres from becoming pale grooves.
    """
    res=rgb.shape[0]
    for fur,box in ((False,(.845,.025,.985,.620)),(True,(.845,.650,.985,.975))):
        x0,y0,x1,y1=[round(v*res) for v in box]
        u=np.linspace(0,1,x1-x0)[None,:];t=np.linspace(0,1,y1-y0)[:,None]
        phase=2*math.pi*(u*(85 if fur else 62)+.12*np.sin(t*13)+.06*np.sin(t*37+u*7))
        fine=.5+.5*np.sin(phase)
        group=.5+.5*np.sin(u*2*math.pi*(11 if fur else 7)+.4*np.sin(t*9))
        if fur:
            f=np.clip(t/.30,0,1)[...,None]
            C=np.asarray(pal['fur_root'])*(1-f)+np.asarray(pal['fur'])*f
            f=np.clip((t-.48)/.52,0,1)[...,None]*.72
            C=C*(1-f)+np.asarray(pal['fur_tip'])*f
            C=C*(.66+.25*fine+.14*group)[...,None]
            R=.83+.10*(1-fine);X=.055*np.cos(phase)
        else:
            f=np.clip(t/.8,0,1)[...,None]*.4
            C=np.asarray(pal['hair'])*(1-f)+np.asarray(pal['hair_tip'])*f
            C=C*(.70+.19*fine+.13*group)[...,None]*(.63+.37*np.clip(t/.14,0,1))[...,None]
            R=.73+.14*(1-fine);X=.035*np.cos(phase)
        C=np.broadcast_to(C,(y1-y0,x1-x0,3)).copy()
        O=np.stack([np.broadcast_to(.65+.28*np.clip(t/.24,0,1),fine.shape),R,np.zeros_like(fine)],axis=-1)
        Y=np.zeros_like(X);Z=np.sqrt(np.maximum(1-X*X,0))
        N=np.stack([X*.5+.5,Y+.5,Z*.5+.5],axis=-1)
        pad=16 if res>=2048 else 8
        for target,src in ((rgb,C),(orm,O),(normal,N)):
            target[y0-pad:y1+pad,x0-pad:x1+pad]=np.pad(src,((pad,pad),(pad,pad),(0,0)),mode='edge')


def game_budget(parts, arm, head_box):
    """Owner r18 fresh 2P boss gate: retain face/hands/mane, trim torso and tiny fur facets.

    Runs after the bake, preserving atlas coordinates. Also used by the CPU-only
    budget correction of the single r18 release bake.
    """
    result={}
    for name,target in [('body_lo',22000),('pauldron_lo_L',5000),('pauldron_lo_R',5000)]:
        ob=parts[name];before=meshutil.tri_count(ob)
        for mod in list(ob.modifiers):
            if mod.type=='ARMATURE':ob.modifiers.remove(mod)
        if name=='body_lo':
            lo,hi=head_box
            mask=lambda P:np.all((P>=lo)&(P<=hi),axis=1)
            count=pipeline.face_vert_mask_tris(ob,mask(meshutil.get_verts(ob)))
            pipeline.decimate_regions(ob,[(lambda P:~mask(P),max(1000,target-count))],symmetry=True)
        meshutil.decimate(ob,target,symmetry=name=='body_lo')
        meshutil.triangulate(ob)
        names=[g.name for g in ob.vertex_groups]
        W=skin.read_groups(ob,names);W,_=skin.top_k(W,4);skin.write_groups(ob,names,W);skin.bind(ob,arm)
        result[name]={'before':before,'after':meshutil.tri_count(ob),'target':target}
    return result


def paint_shell(c,pal,fur=False):
    t,lat,lid=c.attr('along'),c.attr('lateral'),c.attr('lock_id')
    s=.5+.5*np.sin(lat*math.pi*9+np.sin(t*14+lid)*.40)
    if fur:
        root=np.asarray(pal['fur_root']); mid=np.asarray(pal['fur']); tip=np.asarray(pal['fur_tip'])
        f=np.clip(t/.25,0,1)
        rgb=root[None,:]*(1-f[:,None])+mid[None,:]*f[:,None]
        f=np.clip((t-.50)/.50,0,1)*.65
        rgb=rgb*(1-f[:,None])+tip[None,:]*f[:,None]
        rough=.87+0*t
    else:
        rgb=np.tile(pal['hair'],(c.n,1))*(.83+.27*(.5+.5*np.sin(lid*4.1)))[:,None]
        rgb*= (.70+.30*np.clip(t/.12,0,1))[:,None]
        rgb*= (.86+.14*s)[:,None]
        # Low contrast directional satin accents, never pale baked specular stripes.
        rgb+=np.asarray(pal['hair_hi'])[None,:]*(.025*s*np.sin(t*math.pi)**4)[:,None]
        rough=.73+.13*(1-s)+.03*np.sin(lid*3)
    rgb*= (.83+.17*s)[:,None] if fur else 1
    return shaders.out(c.n,rgb,rough)


def join_character(objects, arm, name):
    """Clean SDF decimation remnants and assemble canonical triangle/corner buffers.

    Thin overlapping kilt strips can leave duplicate and tiny faces after decimation.
    Filter those while preserving every part's UV corners and named skin groups.
    """
    verts, faces, uvs, blocks = [], [], [], []
    names = list(dict.fromkeys(g.name for ob in objects for g in ob.vertex_groups))
    offset = 0
    stats = {}
    for ob in objects:
        me = ob.data
        P = meshutil.get_verts(ob, world=True)
        ls = np.empty(len(me.polygons),np.int32); me.polygons.foreach_get('loop_start',ls)
        lt = np.empty(len(me.polygons),np.int32); me.polygons.foreach_get('loop_total',lt)
        if not np.all(lt==3): raise RuntimeError('Non-triangular export part '+ob.name)
        lv = np.empty(len(me.loops),np.int32); me.loops.foreach_get('vertex_index',lv)
        F = lv[ls[:,None]+np.arange(3)]
        UV = np.empty((len(me.loops),2),np.float32); me.uv_layers.active.data.foreach_get('uv',UV.ravel())
        area = np.linalg.norm(np.cross(P[F[:,1]]-P[F[:,0]],P[F[:,2]]-P[F[:,0]]),axis=1)
        keep = area>1e-10
        _, first = np.unique(np.sort(F,axis=1),axis=0,return_index=True)
        unique = np.zeros(len(F),bool); unique[first]=True; keep &= unique
        stats[ob.name]={'input':len(F),'export':int(keep.sum()),'removed':int((~keep).sum())}
        verts.append(P); faces.append(F[keep]+offset); uvs.append(UV[ls[keep,None]+np.arange(3)].reshape(-1,2))
        blocks.append(skin.read_groups(ob,names)); offset+=len(P)
    out=meshutil.mesh_from_numpy(name,np.concatenate(verts),tris=np.concatenate(faces))
    uv=out.data.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',np.concatenate(uvs).ravel())
    W=np.concatenate(blocks);W,_=skin.top_k(W,4);skin.write_groups(out,names,W);skin.bind(out,arm)
    for ob in objects: bpy.data.objects.remove(ob,do_unlink=True)
    return out,stats
