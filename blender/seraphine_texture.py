"""Seraphine atlas compositor: r27 costume palette, fitted borders and head hooks.

Inputs and authored role tiles are read-only.

Only UV coordinates and map samples change; geometry, corner normals and skin
weights are copied from the already-retargeted integration buffers.
"""
import os
import hashlib
import time
import numpy as np
import seraphine_team as T
from brann_texture import (uv_groups, layout_rects, read_png, blank_maps,
                           join_buffers, density)

CONFIG = {'res': 2048, 'surface_width': 1360, 'gutter': 10,
          'body_density': 750., 'body_rim': .97, 'groom_rim': .025,
          'cutoff': .4, 'specular': .06, 'dilation': 12,
          'out': os.environ.get('KCA_SERAPHINE_TEXTURE_OUT',
                               os.path.join(T.TEAM,'texture','job_'+str(os.getpid())))}


_LEG_IDS = None
_TORSO_IDS = None
_KILT_IDS = None
_RETARGET = None
_COSTUME_DONOR = None


def material_points(b):
    """Evaluate costume masks in the same donor frame as fitted geometry.

    The previous compositor tested already-retargeted points against donor-frame
    cutoffs; this painted isolated teal pieces on the upper arms and collar.
    Invert the exact per-vertex blended affine map, without changing any buffer.
    """
    if _RETARGET is None:return b['P']
    matrices,offsets,dz=_RETARGET
    W=b['W']/np.maximum(b['W'].sum(1,keepdims=True),1e-12)
    A=np.einsum('nb,bij->nij',W,matrices)
    q=b['P']-W@offsets-np.array([0,0,dz])
    return np.linalg.solve(A,q[...,None])[...,0]

def rectangles(boxes,pad=12):
    free=[(0,0,1360,2048),(1392,16,640,352)];placed={}
    for i in sorted(range(len(boxes)),key=lambda i:(-max(boxes[i]),-np.prod(boxes[i]))):
        w,h=boxes[i]+pad
        choices=[(min(fw-w,fh-h),max(fw-w,fh-h),x,y) for x,y,fw,fh in free if w<=fw and h<=fh]
        if not choices:return None
        _,_,x,y=min(choices);placed[i]=np.array([x+pad//2,y+pad//2]);new=[]
        for fx,fy,fw,fh in free:
            if x>=fx+fw or x+w<=fx or y>=fy+fh or y+h<=fy:new.append((fx,fy,fw,fh));continue
            if fx<x:new.append((fx,fy,x-fx,fh))
            if fx+fw>x+w:new.append((x+w,fy,fx+fw-x-w,fh))
            if fy<y:new.append((fx,fy,fw,y-fy))
            if fy+fh>y+h:new.append((fx,y+h,fw,fy+fh-y-h))
        free=[a for j,a in enumerate(new)if not any(k!=j and b[0]<=a[0]and b[1]<=a[1]and b[0]+b[2]>=a[0]+a[2]and b[1]+b[3]>=a[1]+a[3]for k,b in enumerate(new))]
    return placed

def log(s):
    print('[seraphine-texture] '+s, flush=True)


def maps_for(prefix, ext='png'):
    return {k: read_png(prefix+'_'+k+'.'+ext) for k in ('albedo','orm','normal')}


def sample(A, uv):
    h,w=A.shape[:2]
    xy=np.clip(uv*np.array([w,h])-.5,[0,0],[w-1.001,h-1.001])
    x,y=xy.astype(int).T; f=xy-np.floor(xy)
    fx,fy=f.T
    return ((A[y,x]*(1-fx[:,None])+A[y,x+1]*fx[:,None])*(1-fy[:,None])+
            (A[y+1,x]*(1-fx[:,None])+A[y+1,x+1]*fx[:,None])*fy[:,None])


def edge_charts(b,U,ids=None):
    """Charts require a shared UV EDGE, matching qa_model's island definition.

    A vertex-only union can join two pinched islands and silently lose gutters.
    """
    if ids is None:ids=np.arange(len(U))
    p=b['P'][b['F'][ids]];v=np.round(p,7);u=np.round(U,6)
    parent=np.arange(len(U));edges={}
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for i in range(len(U)):
        keys=[tuple(np.r_[v[i,k],u[i,k]]) for k in range(3)]
        for a,c in ((0,1),(1,2),(2,0)):
            key=tuple(sorted((keys[a],keys[c])))
            edges.setdefault(key,[]).append(i)
    for fs in edges.values():
        if len(fs)==2:parent[find(fs[0])]=find(fs[1])
    charts={}
    for i in range(len(U)):charts.setdefault(find(i),[]).append(i)
    return [np.array(c,dtype=int) for c in charts.values()]


def project_repair(b, ids):
    """Weld a scratch mesh for the unwrap only; final arrays are never welded."""
    import bpy
    from lib import meshutil, pipeline
    P=b['P'][b['F'][ids]].reshape(-1,3)
    _,first,inv=np.unique(np.round(P,7),axis=0,return_index=True,return_inverse=True)
    ob=meshutil.mesh_from_numpy('texture_uv_scratch',P[first],tris=inv.reshape(-1,3))
    ob.data.uv_layers.new(name='UVMap')
    pipeline.smart_project_faces(ob,np.ones(len(ids),bool),angle=66)
    pipeline.normalize_density(ob,np.ones(len(ids),bool),CONFIG['body_density']/2048)
    uv=np.empty((len(ids)*3,2),np.float32)
    ob.data.uv_layers.active.data.foreach_get('uv',uv.ravel())
    bpy.data.objects.remove(ob,do_unlink=True)
    return uv.reshape(-1,3,2).astype(float)


def prepare_surface(b):
    U=b['UV'].copy();p=b['P'][b['F']]
    a3=np.linalg.norm(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),axis=1)
    e=U[:,1]-U[:,0];f=U[:,2]-U[:,0]
    a2=np.abs(e[:,0]*f[:,1]-e[:,1]*f[:,0])
    den=np.sqrt(a2/np.maximum(a3,1e-20))*2048
    repair=np.zeros(len(U),bool);keep=[]
    for ids in edge_charts(b,U):
        lo=U[ids].min((0,1));hi=U[ids].max((0,1))
        # Retained, healthy original charts move by integer translations only.
        sg=e[ids,0]*f[ids,1]-e[ids,1]*f[ids,0]
        good=(np.all(sg>0) or np.all(sg<0)) and (len(ids)>=8 and np.all(den[ids]>250) and np.all(den[ids]<1800)
              and np.all((hi-lo)*2048>4))
        if good:keep.append(ids)
        else:repair[ids]=True
    ids=np.flatnonzero(repair)
    if len(ids):U[ids]=project_repair(b,ids)
    charts=keep+[ids[c] for c in edge_charts(b,U[ids],ids)] if len(ids) else keep
    boxes=[]
    for c in charts:
        lo=np.floor(U[c].min((0,1))*2048).astype(int)
        hi=np.ceil(U[c].max((0,1))*2048).astype(int)
        boxes.append((c,lo,np.maximum(hi-lo,1)))
    positions=rectangles([x[2] for x in boxes],pad=CONFIG['gutter'])
    if positions is None:
        # Do not scale surviving donor charts. Repairing the residual charts gives
        # coherent islands instead of thousands of padded single-face boxes.
        ids=np.arange(len(U));U=project_repair(b,ids);charts=edge_charts(b,U)
        boxes=[]
        for c in charts:
            lo=np.floor(U[c].min((0,1))*2048).astype(int)
            hi=np.ceil(U[c].max((0,1))*2048).astype(int)
            boxes.append((c,lo,np.maximum(hi-lo,1)))
        for scale in (1., .92, .84, .76, .68):
            trial=U*scale; boxes=[]
            for c in charts:
                lo=np.floor(trial[c].min((0,1))*2048).astype(int)
                hi=np.ceil(trial[c].max((0,1))*2048).astype(int)
                boxes.append((c,lo,np.maximum(hi-lo,1)))
            positions=rectangles([x[2] for x in boxes],pad=CONFIG['gutter'])
            if positions is not None:
                U=trial;log(f'repaired chart density {CONFIG["body_density"]*scale:.0f}px/m, {len(charts)} charts');break
        repair[:]=True
    if positions is None:
        log(f'packing failed: {len(boxes)} charts')
        np.savez(os.path.join(CONFIG['out'],'failed_surface.npz'),U=U,P=b['P'],F=b['F'])
        raise RuntimeError('surface repaired charts do not fit at configured density')
    new=U.copy()
    for i,(ids,lo,wh) in enumerate(boxes):new[ids]+=(positions[i]-lo)/2048
    return new,{'repaired_faces':int(repair.sum()),'retained_translation_faces':int((~repair).sum()),
                'charts':len(charts),'spare_charts':sum(int(p[0]>=1392) for p in positions.values()),'gutter_px_2048':CONFIG['gutter'],'repair':'welded scratch smart projection; original buffers unchanged'}


def donor_scale_mask(maps,out):
    """Teal material plus its baked fine gold lips; dark leather stays protected."""
    import subprocess
    src=os.path.join(out,'scale_mask_input.npy');dst=os.path.join(out,'scale_mask.npy')
    np.save(src,maps['albedo'][...,:3])
    code="""import numpy as np,sys
from scipy.ndimage import distance_transform_edt
rgb=np.load(sys.argv[1]);r,g,b=rgb.transpose(2,0,1)
teal=(g>r*1.15)&(b>r*1.05)
gold=(r>.30)&(g>b*1.15)&(r<g*2.0)
dist=distance_transform_edt(~teal)
# Tiny inherited baked cavities and gold-lip remnants interrupted the leather
# with dark triangular flecks. Fill only small neighbours of the teal material;
# broad russet harness charts remain outside this radius.
dark=(np.max(rgb,axis=2)<.23)&(dist<=5.0)
pale=(np.min(rgb,axis=2)>.50)&(dist<=6.0)
mask=(teal|dark|pale).astype(np.float32)+.5*((~teal)&(~dark)&(~pale)&gold&(dist<=4.0))
np.save(sys.argv[2],mask)
"""
    subprocess.run([os.path.expanduser('~/kca-assets/venv/bin/python'),'-c',code,src,dst],check=True)
    # Temporary semantic channel, never exported as opacity on the opaque body.
    maps['albedo'][...,3]=np.load(dst).astype(np.float32)
    os.remove(src);os.remove(dst)


def scale_field(P):
    """Curved overlapping scale lips, 35mm rows; returns height and edge masks."""
    u=(np.arctan2(P[:,0],-(P[:,1]-.012))/(2*np.pi)+.5)*23
    z=P[:,2]/.035
    row=np.floor(z)
    x=(u-.5*(row%2))%1
    arc=np.sqrt(np.maximum(.015,1-(2*x-1)**2))
    phase=(z+.43*arc)%1
    # A rolled lip and gently convex leather face, with a shallow dark gap.
    lip=np.exp(-((phase-.13)/.085)**2)
    gap=np.exp(-(np.minimum(phase,1-phase)/.045)**2)
    height=.0025*lip+.0008*np.sin(phase*np.pi)-.0005*gap
    return height,lip,gap,row,np.floor(u)


def scale_colour(P, A, O, N, tangent=None, bitangent=None, leg_weight=None, torso_weight=None, kilt_weight=None, fitted_vest=False, force_skin=False):
    """r27: costume contrast and tangent-space scale relief; fitted rest masks."""
    rgb=A[:,:3]
    m=(A[:,3]>.25)&(P[:,2]>1.05)&(P[:,2]<1.52)
    edge=None
    if torso_weight is not None:
        az=np.arctan2(P[:,0],-(P[:,1]-.012))
        edge=1.487+.106*np.clip((np.abs(P[:,0])-.06)/.077,0,1)
        from seraphine_costume_fix4 import garment_distance
        vest=((garment_distance(P,_COSTUME_DONOR)>=-1e-7)|np.full(len(P),fitted_vest,dtype=bool))&~np.full(len(P),force_skin,dtype=bool)
        # Old teal/gold scraps outside the new fitted vest belong to exposed
        # skin. Classify in space/skin weights, independent of packed UV charts.
        skin=~vest&(P[:,2]>1.18)&(P[:,2]<1.60)&(np.abs(P[:,0])<.39)
        A[skin,:3]=[.755,.525,.365];O[skin,0]=1;O[skin,1]=.80;O[skin,2]=0
        N[skin,:3]=[.5,.5,1.]
        m=vest
    # r28 saturated mid-dark amethyst leather. Hue and trim carry floor
    # separation; never lift the broad leg albedo toward pastel again.
    legs=(P[:,2]>.565)&(P[:,2]<1.073)&(np.abs(P[:,0])<.26)
    is_red=(rgb[:,0]>rgb[:,1]*1.85)&(rgb[:,0]>rgb[:,2]*1.55)
    leather=legs&((kilt_weight<.05) if kilt_weight is not None else ~is_red)
    tone=.97+.018*np.sin(P[leather,2]*19)+.012*np.sin(P[leather,0]*31)
    A[leather,:3]=tone[:,None]*[.275,.065,.32]
    N[leather,:3]=[.5,.5,1.]
    O[leather,:3]=[1,.87,0]
    boot=(P[:,2]>.035)&(P[:,2]<=.565)&(np.abs(P[:,0])<.26)
    if kilt_weight is not None:boot&=kilt_weight<.05
    if leg_weight is not None:boot&=leg_weight>.2
    A[boot,:3]=[.145,.083,.062];O[boot,:3]=[1,.86,0];N[boot,:3]=[.5,.5,1]
    # Four crisp, evenly spaced leather straps, with small bronze buckles at
    # the forward outer quarter. No crossing diagonal cow-print pattern.
    strap=np.zeros(len(P),bool)
    for height in (.15,.255,.36,.465):strap|=np.abs(P[:,2]-height)<.012
    strap&=boot
    A[strap,:3]=[.34,.215,.115];O[strap,:3]=[1,.82,0]
    cx=np.where(P[:,0]>0,.097,-.097)
    theta=np.arctan2(np.abs(P[:,0]-cx),-(P[:,1]-.006))
    buckle=strap&(np.abs(theta-.62)<.25)
    # Thin rectangular buckle frame leaves the central dark leather visible.
    by=np.min(np.abs(P[:,2,None]-np.array([.15,.255,.36,.465])[None]),axis=1)
    frame=buckle&((by>.008)|(np.abs(theta-.62)>.17))
    A[frame,:3]=[.63,.405,.17];O[frame,:3]=[1,.58,.5]
    sole=(P[:,2]<=.035)&(np.abs(P[:,0])<.26)
    A[sole,:3]=[.075,.048,.045];O[sole,:3]=[1,.92,0]
    waist=(P[:,2]>1.035)&(P[:,2]<1.105)&(np.abs(P[:,0])<.24)
    if kilt_weight is not None:waist&=kilt_weight<.05
    A[waist,:3]=[.32,.027,.056];O[waist,:3]=[1,.86,0];N[waist,:3]=[.5,.5,1]
    crimson=(rgb[:,0]>rgb[:,1]*1.85)&(rgb[:,0]>rgb[:,2]*1.55)&(P[:,2]<1.12)&~leather
    if crimson.any():
        shade=np.clip(rgb[crimson,0]/.6,.60,1.15)
        folds=.87+.13*np.sin(P[crimson,1]*180+P[crimson,2]*19)
        A[crimson,:3]=(shade*folds)[:,None]*[.76,.055,.115]
        O[crimson,0]=1;O[crimson,1]=.72
    if force_skin == 1:
        for side in ('L','R'):
            sh=_COSTUME_DONOR.joints['upperarm_'+side]
            axis=_COSTUME_DONOR.joints['forearm_'+side]-sh;axis=axis/np.linalg.norm(axis)
            along=(P-sh)@axis
            own=(P[:,0]>0) if side=='L' else (P[:,0]<0)
            guard=own&(along<.042)&(along>-.11) if side=='R' else own&(along>-.035)&(along<.005)
            A[guard,:3]=[.16,.066,.029];O[guard,:3]=[1,.90,0];N[guard,:3]=[.5,.5,1]
            seam=guard&(np.abs(along-(.039 if side=='R' else .002))<.002)
            A[seam,:3]=[.58,.36,.13];O[seam,:3]=[1,.68,.25]
    if not m.any():return
    Q=P[m];height,lip,gap,row,colid=scale_field(Q)
    col=np.tile([.065,.265,.225],(len(Q),1))
    col+=lip[:,None]*[.16,.26,.20]
    col*=1-.78*gap[:,None]
    col*=(1+.09*np.sin(row*17+colid*13))[:,None]
    A[m,:3]=col;O[m,0]=1-.17*gap;O[m,1]=.67-.12*lip;O[m,2]=.07
    if tangent is not None and bitangent is not None:
        eps=.00035
        dx=(scale_field(Q+eps*tangent)[0]-scale_field(Q-eps*tangent)[0])/(2*eps)
        dy=(scale_field(Q+eps*bitangent)[0]-scale_field(Q-eps*bitangent)[0])/(2*eps)
        v=np.stack([-dx,-dy,np.ones(len(Q))],1)
        v/=np.maximum(np.linalg.norm(v,axis=1,keepdims=True),1e-8)
        N[m,:3]=v*.5+.5
    if edge is not None:
        collar=m&((P[:,2]>edge-.014)|(P[:,2]<1.103))
        A[collar,:3]=[.25,.125,.062];O[collar,:3]=[1,.75,0];N[collar,:3]=[.5,.5,1.]
        stitch=collar&(P[:,2]>edge-.0018)
        A[stitch,:3]=[.59,.385,.16];O[stitch,:3]=[1,.60,.35]
        shoulder=m&(np.abs(P[:,0])>.112)&(P[:,2]>1.485)
        A[shoulder,:3]=[.18,.085,.043];O[shoulder,:3]=[1,.86,0];N[shoulder,:3]=[.5,.5,1.]



def transfer(b, new, source, target, scales=True):
    """Bilinear old→new triangle transfer, then nearest covered-texel gutters."""
    h,w=target['albedo'].shape[:2];extent=np.array([w,h])
    MP=material_points(b) if scales else b['P']
    if scales:import seraphine_head_fix3 as headfix
    legw=b['W'][:,_LEG_IDS].sum(1) if _LEG_IDS is not None else None
    torsow=b['W'][:,_TORSO_IDS].sum(1) if _TORSO_IDS is not None else None
    kiltw=b['W'][:,_KILT_IDS].sum(1) if _KILT_IDS is not None else None
    cov=np.zeros((h,w),bool)
    for i,(old,uv) in enumerate(zip(b['UV'],new)):
        pt=uv*extent
        lo=np.maximum(np.floor(pt.min(0)).astype(int),0)
        hi=np.minimum(np.ceil(pt.max(0)).astype(int),extent-1)
        if np.any(hi<lo):continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        a,c,d=pt;det=np.cross(c-a,d-a)
        if abs(det)<1e-12:continue
        # New atlas UVs define the actual exported tangent frame. Evaluating
        # height along these directions avoids world-space grooves on rotated charts.
        tri=b['P'][b['F'][i]];e1=tri[1]-tri[0];e2=tri[2]-tri[0]
        du=uv[1]-uv[0];dv=uv[2]-uv[0];ud=du[0]*dv[1]-du[1]*dv[0]
        tangent=(e1*dv[1]-e2*du[1])/(ud if abs(ud)>1e-15 else 1)
        tangent/=max(np.linalg.norm(tangent),1e-12)
        bn=np.cross(e1,e2);bn/=max(np.linalg.norm(bn),1e-12)
        bitangent=np.cross(bn,tangent)*np.sign(ud)
        w1=((xx-a[0])*(d[1]-a[1])-(yy-a[1])*(d[0]-a[0]))/det
        w2=((c[0]-a[0])*(yy-a[1])-(c[1]-a[1])*(xx-a[0]))/det
        mask=(w1>=-1e-6)&(w2>=-1e-6)&(w1+w2<=1+1e-6)
        if not mask.any():
            # Every subpixel micro-chart gets a source-colour seed for mips.
            xy=np.clip(np.floor(pt.mean(0)).astype(int),0,extent-1)
            samples={k:sample(A,old.mean(0)[None]) for k,A in source.items()}
            if scales:
                # Fitted shell opts into costume paint via its constant source UV marker.
                fitted=bool(np.max(np.abs(old-[.3,.3]))<1e-7)
                scale_colour(MP[b['F'][i]].mean(0)[None],samples['albedo'],samples['orm'],samples['normal'],tangent,bitangent,np.array([legw[b['F'][i]].mean()]) if legw is not None else None,np.array([torsow[b['F'][i]].mean()]) if torsow is not None else None,np.array([kiltw[b['F'][i]].mean()]) if kiltw is not None else None,fitted_vest=fitted,force_skin=(2 if np.max(np.abs(old-[.26,.26]))<1e-7 else bool(min(np.max(np.abs(old-[.28,.28])),np.max(np.abs(old-[.27,.27])))<1e-7)))
                headfix.apply_skin(b['P'][b['F'][i]].mean(0)[None],samples['albedo'],samples['orm'],samples['normal'],frame='retarget')
            for k,A in samples.items():target[k][xy[1],xy[0]]=A[0]
            cov[xy[1],xy[0]]=True
            continue
        W=np.stack([1-w1[mask]-w2[mask],w1[mask],w2[mask]],1)
        samples={k:sample(A,W@old) for k,A in source.items()}
        if scales:
            fitted=bool(np.max(np.abs(old-[.3,.3]))<1e-7)
            scale_colour(W@MP[b['F'][i]],samples['albedo'],samples['orm'],samples['normal'],tangent,bitangent,W@legw[b['F'][i]] if legw is not None else None,W@torsow[b['F'][i]] if torsow is not None else None,W@kiltw[b['F'][i]] if kiltw is not None else None,fitted_vest=fitted,force_skin=(2 if np.max(np.abs(old-[.26,.26]))<1e-7 else bool(min(np.max(np.abs(old-[.28,.28])),np.max(np.abs(old-[.27,.27])))<1e-7)))
            headfix.apply_skin(W@b['P'][b['F'][i]],samples['albedo'],samples['orm'],samples['normal'],frame='retarget')
        # Repaired tangent frames differ: neutral inherited normal detail rather
        # than rotating donor grooves into false shadows. Scales author new detail.
        for k,A in samples.items():target[k][lo[1]:hi[1]+1,lo[0]:hi[0]+1][mask]=A
        cov[lo[1]:hi[1]+1,lo[0]:hi[0]+1]|=mask
    return cov


def repack_outfit(b,maps,out):
    """Repair folded cylindrical soles/discs in the COMPOSITE, not source tiles."""
    h,w=maps['albedo'].shape[:2];U=project_repair(b,np.arange(len(b['F'])))
    charts=edge_charts(b,U)
    for scale in (1., .85, .70, .55, .45):
        trial=U*scale;boxes=[]
        for ids in charts:
            lo=np.floor(trial[ids].min((0,1))*2048).astype(int)
            hi=np.ceil(trial[ids].max((0,1))*2048).astype(int)
            boxes.append((ids,lo,np.maximum(hi-lo,1)))
        positions=layout_rects([b[2] for b in boxes],w,h,pad=12)
        if positions is not None:
            U=trial;break
    if positions is None:raise RuntimeError('outfit charts do not fit their original-size tile')
    new=U.copy()
    for i,(ids,lo,wh) in enumerate(boxes):new[ids]=(U[ids]*2048-lo+positions[i])/np.array([w,h])
    dest={k:np.zeros_like(a) for k,a in maps.items()}
    maps['normal'][...,:3]=[.5,.5,1]
    cov=transfer(b,new,maps,dest,scales=False);dest=nearest_fill(dest,cov,out)
    dest['albedo'][...,3]=1
    return new,dest,{'charts':len(charts),'density_px_m':CONFIG['body_density']*scale,'gutter_px_2048':12,'source_tile_unchanged':True}


def nearest_fill(maps,cov,out,alpha=False):
    """Use the asset venv's scipy EDT, no Blender slot or image generation needed."""
    import subprocess
    raw=os.path.join(out,'dilate_input.npz');done=os.path.join(out,'dilate_output.npz')
    np.savez(raw,cov=cov,**maps)
    code='''import numpy as np,sys
from scipy.ndimage import distance_transform_edt
z=np.load(sys.argv[1]);cov=z['cov'];_,ind=distance_transform_edt(~cov,return_indices=True)
a={}
for k in ('albedo','orm','normal'):
 v=z[k].copy(); alpha=v[...,3].copy();v[~cov]=v[tuple(ind[:,~cov])]
 if sys.argv[3]=='1' and k=='albedo':v[...,3]=alpha
 a[k]=v
np.savez(sys.argv[2],**a)
'''
    subprocess.run([os.path.expanduser('~/kca-assets/venv/bin/python'),'-c',code,raw,done,'1' if alpha else '0'],check=True)
    z=np.load(done);result={k:z[k] for k in maps};z.close();os.remove(raw);os.remove(done)
    return result


def pack_sheets(D, groups, objs, arm, fast=False, release=False):
    import bpy
    global _LEG_IDS, _TORSO_IDS, _KILT_IDS, _RETARGET, _COSTUME_DONOR
    _COSTUME_DONOR=D
    import seraphine_head_fix3 as headfix
    headfix.smooth_head_normals(groups,D)
    spec=T.load_retarget(os.path.join(T.PARTS_DIR,'body','retarget.json'))
    maps=T.retarget_maps(D,spec)
    _RETARGET=(np.array([maps[n]['A'] for n in D.bones]),
               np.array([maps[n]['new']-maps[n]['A']@maps[n]['old'] for n in D.bones]),
               T.ground_offset(D,maps) if spec.get('ground',True) else 0.)
    _LEG_IDS=[i for i,n in enumerate(D.bones) if n.startswith(("thigh_","shin_"))]
    _TORSO_IDS=[i for i,n in enumerate(D.bones) if n in ("spine","chest")]
    _KILT_IDS=[i for i,n in enumerate(D.bones) if n.startswith("kilt_")]
    from lib import pipeline
    from build_hero_seraphine_team import material_for
    source_hashes={str(key):{k:hashlib.sha256(np.ascontiguousarray(b[k]).tobytes()).hexdigest() for k in ('P','F','N','W')} for key,b in groups.items()}
    t=time.monotonic();mode='release' if release else ('fast' if fast else 'preview')
    out=os.path.join(CONFIG['out'],mode);os.makedirs(out,exist_ok=True)
    body=blank_maps();groom=None;chunks={'body':[],'groom':[]};face=[];surface=[]
    report={'mode':mode,'input_buffers_copied':True,'sheets':{},'surface':[]}
    donor=maps_for(os.path.join(T.DONOR_DIR,'seraphine'),'webp')
    # UV repair changes tangent frames: neutral donor normals; preserve part normals.
    donor['normal'][...,:3]=[.5,.5,1]
    donor_scale_mask(donor,out)
    # Several roles can retain donor-sheet UVs (e.g. replacement sash). Pack
    # these together, once, so independent groups never reuse the same rectangles.
    entries=[];donor_buffers=[]
    for key,b in sorted(groups.items(),key=lambda kv:str(kv[0])):
        if key[1]=='donor_body':donor_buffers.append(b)
        else:entries.append((key,b))
    if donor_buffers:
        joined={k:[] for k in ('P','F','UV','N','W')};offset=0
        for b in donor_buffers:
            for k in joined:joined[k].append(b[k]+offset if k=='F' else b[k])
            offset+=len(b['P'])
        joined={k:np.concatenate(v) for k,v in joined.items()}
        entries.insert(0,(('body','donor_body',False,'composite'),joined))
    for key,b in entries:
        mk,tile,alpha,role=key;ids=np.arange(len(b['F']));U=b['UV'].copy()
        if tile=='donor_body':
            U,r=prepare_surface(b);report['surface'].append(r)
            cov=transfer(b,U,donor,body)
            body=nearest_fill(body,cov,out)
            surface.append((b,ids,U))
        elif tile=='donor_groom':
            if groom is None:groom=maps_for(os.path.join(T.DONOR_DIR,'seraphine_hair'),'webp')
        else:
            maps=maps_for(os.path.join(T.PARTS_DIR,role,'tiles',tile))
            if tile=='outfit':
                U,maps,report['outfit_repair']=repack_outfit(b,maps,out)
            sheet,x0,y0,x1,y1=T.CONFIG['tiles'][tile]
            if maps['albedo'].shape[:2]!=(y1-y0,x1-x0):raise ValueError('wrong tile size '+tile)
            if sheet=='groom':groom=maps
            else:
                for k in body:body[k][y0:y1,x0:x1]=maps[k]
            U=U*np.array([x1-x0,y1-y0])/2048+np.array([x0,y0])/2048
            if tile=='face':face.append((b,ids,U))
        chunks[mk].append((b,ids,U))
    body['albedo'][...,3]=1
    rgb=body['albedo'][...,:3];lin=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    Y=lin@np.array([.2126,.7152,.0722]);L=np.where(Y>.008856,116*np.cbrt(Y)-16,903.3*Y)
    teal=(rgb[...,1]>rgb[...,0]*1.3)&(rgb[...,2]>rgb[...,0]*1.1)
    skin=(rgb[...,0]>.52)&(rgb[...,1]>rgb[...,2]*1.13)&(rgb[...,0]>rgb[...,1]*1.12)
    report['albedo_value_groups']={'teal_Lstar_median':float(np.median(L[teal])) if teal.any() else None,
        'skin_Lstar_median':float(np.median(L[skin])) if skin.any() else None,
        'intent':'fitted dark amethyst leggings, bronze piping, dark flat boots with even buckled straps, crimson sash, auburn groom, bound teal vest, warm skin'}
    if groom is None:raise RuntimeError('no groom sheet supplied')
    groom=nearest_fill(groom,groom['albedo'][...,3]>.01,out,alpha=True)
    report['face_density_x_body']=density(face)/max(density(surface),1e-9)
    report['surface_density_px_m']=density(surface)
    # Independent body-sheet metric (the QA tool's aggregate includes intentional
    # stacked groom UVs). Keep exact arrays for a reproducible per-sheet audit.
    auditP=[];auditF=[];auditU=[];n=0
    for b,ids,U in chunks['body']:
        auditP.append(b['P']);auditF.append(b['F'][ids]+n);auditU.append(U);n+=len(b['P'])
    auditP=np.concatenate(auditP);auditF=np.concatenate(auditF);auditU=np.concatenate(auditU)
    p=auditP[auditF];a3=np.linalg.norm(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),axis=1)
    e=auditU[:,1]-auditU[:,0];f=auditU[:,2]-auditU[:,0];signed=e[:,0]*f[:,1]-e[:,1]*f[:,0]
    den=np.sqrt(np.abs(signed)/np.maximum(a3,1e-20))*2048;med=np.median(den[den>0]);fold=0
    for ids in uv_groups(auditU):
        sg=np.sign(np.sum(signed[ids]));fold+=int(((np.sign(signed[ids])!=sg)&(signed[ids]!=0)).sum())
    report['body_uv_distortion']={'faces':len(den),'median_density':float(med),
        'crushed':int((den<med*.25).sum()),'stretched':int((den>med*4).sum()),'folded':fold,
        'bad_pct':float(((den<med*.25).sum()+(den>med*4).sum()+fold)*100/len(den))}
    np.savez_compressed(os.path.join(out,'body_uv_audit.npz'),P=auditP,F=auditF,UV=auditU)
    final=[];specs={}
    for sheet,maps in [('body',body),('groom',groom)]:
        paths={}
        for k,A in maps.items():
            if fast and not release:A=A.reshape(1024,2,1024,2,4).mean((1,3))
            path=os.path.join(out,f'{sheet}_{k}.png');paths[k]=path
            pipeline.save_png(A,path,colorspace='sRGB' if k=='albedo' else 'Non-Color')
        name=T.CONFIG['sheets'][sheet]['material']
        # Free preview material names so final exported names remain exact.
        old=bpy.data.materials.get(name)
        if old:old.name=name+'_preview'
        mat=material_for(name,paths,alpha=sheet=='groom',cutoff=.4)
        extra=next((m.get('extras',{}).copy() for m in D.json['materials'] if m['name']==name),{})
        extra.pop('kcaRimScale',None)
        specs[name]={'rim':CONFIG[sheet+'_rim'],'alpha':'MASK' if sheet=='groom' else None,
                     'cutoff':.4,'specular':.06 if sheet=='groom' else None,'extras':extra}
        mat['kcaRimScale']=CONFIG[sheet+'_rim']
        obname='hero_seraphine_mesh' if sheet=='body' else 'hero_seraphine_hair'
        ob=join_buffers(chunks[sheet],arm,obname,D.bones);ob.data.materials.append(mat);final.append(ob)
        report['sheets'][sheet]={'size':[1024,1024] if fast and not release else [2048,2048],'maps':paths}
    for ob in objs:bpy.data.objects.remove(ob,do_unlink=True)
    end_hashes={str(key):{k:hashlib.sha256(np.ascontiguousarray(b[k]).tobytes()).hexdigest() for k in ('P','F','N','W')} for key,b in groups.items()}
    assert source_hashes==end_hashes, 'compositor changed source geometry buffers'
    report.update(seconds=round(time.monotonic()-t,2),materials=specs,geometry_buffers_unchanged=True,source_geometry_hashes=source_hashes)
    T.save_json(os.path.join(out,'pack_report.json'),report)
    log(f'pack_sheets ready: {report["seconds"]}s, density ratio {report["face_density_x_body"]:.2f}')
    return {'objects':final,'materials':specs,'report':report}
