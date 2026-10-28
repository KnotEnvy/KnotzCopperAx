"""r27 costume overlay. Run ONLY through blender-run.mjs; writes owned parts.

Rebuilds body from its r24 authoring module, then adds a fitted shoulder saddle,
crimson side/back drape and longer sash. Retarget and plait stay unchanged.
"""
import os
import sys
import json
import argparse
import runpy
import numpy as np
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seraphine_team as T
import seraphine_body as B
import seraphine_groom as G

CONFIG = {"seed": 27, "out": os.path.join(T.PARTS_DIR, "body"),
          "shoulder_relax": 10, "shoulder_mix": .72,
          "plate_sections": 10, "plate_angles": 20,
          "drape_sections": 10, "drape_angles": 18,
          "tail_shortening": -.32}


def save(name, P, F, U, W, D, note, replaces=()):
    P=np.asarray(P);F=np.asarray(F, np.int32);U=np.asarray(U)
    return T.save_part(CONFIG['out'],name,P=P,F=F,UV=U[F],N=G.normals(P,F)[F],
                       W=np.asarray(W),bones=D.bones,tile='outfit',
                       meta={'role':'body','mesh':'body','replaces':list(replaces),'notes':note})


def fitted_weights(points,D,surface,regions,allowed):
    """Nearest edited donor triangle, retaining its real deformation field."""
    M=D.mesh['body'];faces=M.F[M.faces(*regions)]
    tree=BVHTree.FromPolygons(surface.tolist(),faces.tolist(),all_triangles=True)
    W=np.zeros((len(points),len(D.bones)))
    for i,p in enumerate(points):
        hit,normal,index,distance=tree.find_nearest(tuple(p))
        if hit is None:raise RuntimeError('fitted surface transfer missed')
        a,b,c=surface[faces[index]];ab=b-a;ac=c-a;v=np.asarray(hit)-a
        d00=ab@ab;d01=ab@ac;d11=ac@ac;den=max(d00*d11-d01*d01,1e-20)
        u=(d11*(v@ab)-d01*(v@ac))/den;t=(d00*(v@ac)-d01*(v@ab))/den
        bary=np.maximum([1-u-t,u,t],0);bary/=sum(bary)
        W[i]=bary@M.Wn[faces[index]]
    W[:,~np.array([b in allowed for b in D.bones])]=0
    assert (W.sum(1)>1e-8).all()
    return W/np.maximum(W.sum(1,keepdims=True),1e-12)


def fair_torso_edges(D):
    """Fair small donor vest tears before fitting the clean rolled harness."""
    M=D.mesh['body'];E=T.load_edits(CONFIG['out']);P=M.P.copy();P[E['vidx']]=E['P_new']
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    pp=P[first].copy();orig=pp.copy();z=orig[:,2];x=np.abs(orig[:,0])
    owned=np.zeros(len(P),bool);owned[M.verts_of('torso','arm_L','arm_R')]=True
    mask=owned[first]*(1-B.smoothstep(.17,.28,x))*B.smoothstep(1.05,1.12,z)*(1-B.smoothstep(1.54,1.565,z))
    mask[np.isin(M.pos_id[first],D.pinned_positions('body'))]=0
    edges=np.unique(np.sort(np.concatenate([inv[M.F[:,[0,1]]],inv[M.F[:,[1,2]]],inv[M.F[:,[2,0]]]]),axis=1),axis=0)
    for _ in range(28):
        acc=np.zeros_like(pp);count=np.zeros(len(pp))
        np.add.at(acc,edges[:,0],pp[edges[:,1]]);np.add.at(acc,edges[:,1],pp[edges[:,0]])
        np.add.at(count,edges.ravel(),1)
        pp+=(acc/np.maximum(count[:,None],1)-pp)*mask[:,None]*.6
    P=pp[inv];delta=P-M.P;delta*=np.minimum(1,.029/np.maximum(np.linalg.norm(delta,axis=1),1e-12))[:,None]
    P=M.P+delta;vi=np.flatnonzero(np.linalg.norm(delta,axis=1)>1e-8)
    T.save_edits(CONFIG['out'],vidx=vi,P_new=P[vi],fidx=E['fidx'],UV=E['UV'],N=B.smooth_normals(M,P)[E['fidx']],tile='outfit',meta={'role':'body','notes':'r26 fair ragged side/armpit vest edges; welded aliases and neck seam pinned.'})


def shoulder(D):
    """Relax the fused crumpled sheet, with pinned seams and bounded movement."""
    M=D.mesh['body'];E=T.load_edits(CONFIG['out']);P=M.P.copy();P[E['vidx']]=E['P_new']
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    pp=P[first].copy();orig=pp.copy();sh=D.joints['upperarm_L']
    axis=G.norm(D.joints['forearm_L']-sh);up=G.norm(np.array([0.,0,1])-axis*axis[2])
    rel=orig-sh;t=rel@axis;h=rel@up
    mask=(B.smoothstep(-.085,-.025,t)*(1-B.smoothstep(.16,.22,t))*
          B.smoothstep(-.055,-.010,h)*B.smoothstep(.085,.12,orig[:,0]))
    owned=np.zeros(len(M.P),bool);owned[M.verts_of('torso','arm_L')]=True
    mask*=owned[first];mask[np.isin(M.pos_id[first],D.pinned_positions('body'))]=0
    edges=np.concatenate([inv[M.F[:,[0,1]]],inv[M.F[:,[1,2]]],inv[M.F[:,[2,0]]]])
    edges=np.unique(np.sort(edges,axis=1),axis=0)
    for _ in range(CONFIG['shoulder_relax']):
        acc=np.zeros_like(pp);count=np.zeros(len(pp))
        np.add.at(acc,edges[:,0],pp[edges[:,1]]);np.add.at(acc,edges[:,1],pp[edges[:,0]])
        np.add.at(count,edges.ravel(),1)
        pp+=(acc/np.maximum(count[:,None],1)-pp)*mask[:,None]*CONFIG['shoulder_mix']
    P=pp[inv];delta=P-M.P
    delta*=np.minimum(1,.029/np.maximum(np.linalg.norm(delta,axis=1),1e-12))[:,None]
    P=M.P+delta
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    P=P[first][inv]
    pins=np.isin(M.pos_id,D.pinned_positions('body'));P[pins]=M.P[pins]
    delta=P-M.P;vi=np.flatnonzero(np.linalg.norm(delta,axis=1)>1e-8)
    T.save_edits(CONFIG['out'],vidx=vi,P_new=P[vi],fidx=E['fidx'],UV=E['UV'],
                 N=B.smooth_normals(M,P)[E['fidx']],tile='outfit',
                 meta={'role':'body','notes':'r26: r24 slim greaves, locally relaxed shoulder sheet; pinned seams, max29mm.'})
    tree=BVHTree.FromPolygons(P.tolist(),M.F.tolist(),all_triangles=True)
    front=G.norm(np.cross(axis,up))
    if front[1]>0:front=-front
    ts=np.linspace(-.010,.160,CONFIG['plate_sections']+1)
    phis=np.radians(np.linspace(-100,100,CONFIG['plate_angles']+1))
    dirs=up[None]*np.cos(phis[:,None])+front[None]*np.sin(phis[:,None])
    radii=[]
    for i,t in enumerate(ts):
        c=sh+axis*t
        for j,d in enumerate(dirs):
            hit=tree.ray_cast(tuple(c),tuple(d),.20)
            r=float(hit[3]) if hit[0] is not None else .072
            radii.append(r)
    n=len(ts);m=len(phis);radii=np.array(radii).reshape(n,m)
    fit=radii.copy()
    for _ in range(12):
        fit[1:-1,1:-1]=(4*fit[1:-1,1:-1]+fit[:-2,1:-1]+fit[2:,1:-1]+
                        fit[1:-1,:-2]+fit[1:-1,2:])/8
    # Hide the crumpled donor peaks under the clean smooth saddle. Every point
    # remains in the owned region and under the same 29mm edit bound.
    rel=P-sh;along=rel@axis;rad=rel-along[:,None]*axis
    rr=np.linalg.norm(rad,axis=1);ang=np.arctan2(rad@front,rad@up)
    ix=np.clip((along-ts[0])/(ts[-1]-ts[0])*(n-1),0,n-1.001)
    iy=np.clip((ang-phis[0])/(phis[-1]-phis[0])*(m-1),0,m-1.001)
    ii,jj=ix.astype(int),iy.astype(int);u,v=ix-ii,iy-jj
    target=((1-u)*(1-v)*fit[ii,jj]+u*(1-v)*fit[ii+1,jj]+
            (1-u)*v*fit[ii,jj+1]+u*v*fit[ii+1,jj+1])
    sel=owned&(along>ts[0])&(along<ts[-1])&(ang>phis[0])&(ang<phis[-1])
    push=np.maximum(0,rr-target+.0002)*sel
    P-=rad/np.maximum(rr[:,None],1e-9)*push[:,None]
    delta=P-M.P;delta*=np.minimum(1,.029/np.maximum(np.linalg.norm(delta,axis=1),1e-12))[:,None]
    P=M.P+delta
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    P=P[first][inv]
    pins=np.isin(M.pos_id,D.pinned_positions('body'));P[pins]=M.P[pins]
    delta=P-M.P;vi=np.flatnonzero(np.linalg.norm(delta,axis=1)>1e-8)
    T.save_edits(CONFIG['out'],vidx=vi,P_new=P[vi],fidx=E['fidx'],UV=E['UV'],
                 N=B.smooth_normals(M,P)[E['fidx']],tile='outfit',
                 meta={'role':'body','notes':'r26: slim greaves; smooth shoulder peaks fitted under bevelled saddle, pins unchanged, max29mm.'})
    pp=np.array([sh+axis*t+d*(fit[i,j]+.0013) for i,t in enumerate(ts) for j,d in enumerate(dirs)])
    ff=G.grid_faces(n,m)
    hint=G.norm(pp[ff].mean(1)-(sh+np.clip((pp[ff].mean(1)-sh)@axis,ts[0],ts[-1])[:,None]*axis))
    ff=G.orient(pp,ff,hint)
    # Fold the outermost strip down by 0.6mm: a clean bevel under the bronze rim.
    U=np.stack(np.meshgrid(np.linspace(.08,.43,m),np.linspace(.923,.934,n)),axis=-1).reshape(-1,2)
    W=B.transfer_surface_weights(pp,D,['torso','arm_L'],['chest','clavicle_L','upperarm_L'])
    save('shoulder_saddle',pp,ff,U,W,D,'r26 fitted teal leather shoulder saddle; continuous bevelled bronze perimeter.')
    ids=list(range(m))+[i*m+m-1 for i in range(1,n)]+list(range((n-1)*m+m-2,(n-1)*m-1,-1))+[i*m for i in range(n-2,0,-1)]
    path=pp[ids];path=np.vstack([path,path[0]])
    rp,rf=G.tube(path,.0017,6,False)
    rw=B.transfer_surface_weights(rp,D,['torso','arm_L'],['chest','clavicle_L','upperarm_L'])
    save('shoulder_bronze_rim',rp,rf,np.tile((.50,.957),(len(rp),1)),rw,D,'Continuous rolled bronze edge, radius1.7mm, sits on saddle.')
    # Broad proper strap over the saddle from front to back, with simple UVs.
    mid=3;sp=pp.reshape(n,m,3)[mid:mid+3].copy().reshape(-1,3)
    for i in range(len(sp)):
        centre=sh+axis*((sp[i]-sh)@axis);sp[i]+=G.norm(sp[i]-centre)*.0015
    sf=G.grid_faces(3,m);sf=G.orient(sp,sf,G.norm(sp[sf].mean(1)-sh))
    su=np.stack(np.meshgrid(np.linspace(.52,.89,m),np.linspace(.902,.918,3)),axis=-1).reshape(-1,2)
    sw=B.transfer_surface_weights(sp,D,['torso','arm_L'],['chest','clavicle_L','upperarm_L'])
    save('shoulder_strap',sp,sf,su,sw,D,'Broad smooth russet leather strap over shoulder plate; no crumpled donor bake.')
    return P


def drape_weights(P,D,az):
    """Smooth neighbouring kilt-chain blends; no thigh or arm influences."""
    W=np.zeros((len(P),len(D.bones)))
    for i,(p,a) in enumerate(zip(P,az)):
        al=B.smoothstep(39,71,a);ab=B.smoothstep(119,151,a)
        angular={'F':1-al,'L':al*(1-ab),'B':ab}
        for side,amount in angular.items():
            names=['hips']+[f'kilt_{side}_{j}' for j in (1,2,3)]
            zs=[1.065]+[D.joints[n][2] for n in names[1:]]
            # Interpolate EACH chain in its own rest frame before angular mixing.
            j=int(np.clip(np.searchsorted(-np.array(zs),-p[2])-1,0,2))
            f=np.clip((zs[j]-p[2])/max(zs[j]-zs[j+1],.001),0,1)
            W[i,D.bones.index(names[j])]+=amount*(1-f)
            W[i,D.bones.index(names[j+1])]+=amount*f
    return W


def right_shoulder_strap(D,P,side="R"):
    """A narrow smooth leather shoulder harness, fitted to the edited body."""
    prefix="right" if side=="R" else "left"
    M=D.mesh['body'];E=T.load_edits(CONFIG['out'])
    sh=D.joints['upperarm_'+side];axis=G.norm(D.joints['forearm_'+side]-sh)
    up=G.norm(np.array([0.,0,1])-axis*axis[2]);front=G.norm(np.cross(axis,up))
    if front[1]>0:front=-front
    ts=np.linspace(-.052,-.012,5);phis=np.radians(np.linspace(-118,118,25))
    dirs=up[None]*np.cos(phis[:,None])+front[None]*np.sin(phis[:,None])
    tree=BVHTree.FromPolygons(P.tolist(),M.F.tolist(),all_triangles=True)
    radius=[]
    for t in ts:
        for d in dirs:
            hit=tree.ray_cast(tuple(sh+axis*t),tuple(d),.25)
            radius.append(float(hit[3]) if hit[0] is not None else .075)
    fit=np.array(radius).reshape(len(ts),len(phis))
    for _ in range(12):
        fit[1:-1,1:-1]=(4*fit[1:-1,1:-1]+fit[:-2,1:-1]+fit[2:,1:-1]+fit[1:-1,:-2]+fit[1:-1,2:])/8
    # Push folded donor peaks behind the strap while leaving its four edges
    # attached to the original surface. Preserve every other vertex.
    rel=P-sh;along=rel@axis;rad=rel-along[:,None]*axis;rr=np.linalg.norm(rad,axis=1)
    ang=np.arctan2(rad@front,rad@up)
    x=np.clip((along-ts[0])/(ts[-1]-ts[0])*4,0,3.999)
    y=np.clip((ang-phis[0])/(phis[-1]-phis[0])*24,0,23.999)
    i,j=x.astype(int),y.astype(int);u,v=x-i,y-j
    target=(1-u)*(1-v)*fit[i,j]+u*(1-v)*fit[i+1,j]+(1-u)*v*fit[i,j+1]+u*v*fit[i+1,j+1]
    owned=np.zeros(len(P),bool);owned[M.verts_of('torso','arm_'+side)]=True
    sel=owned&(along>ts[0])&(along<ts[-1])&(ang>phis[0])&(ang<phis[-1])
    sel&=~np.isin(M.pos_id,D.pinned_positions('body'))
    P-=rad/np.maximum(rr[:,None],1e-12)*np.maximum(rr-target+.0002,0)[:,None]*sel[:,None]
    delta=P-M.P;delta*=np.minimum(1,.029/np.maximum(np.linalg.norm(delta,axis=1),1e-12))[:,None]
    P=M.P+delta
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    P=P[first][inv];pins=np.isin(M.pos_id,D.pinned_positions('body'));P[pins]=M.P[pins]
    delta=P-M.P;vi=np.flatnonzero(np.linalg.norm(delta,axis=1)>1e-8)
    T.save_edits(CONFIG['out'],vidx=vi,P_new=P[vi],fidx=E['fidx'],UV=E['UV'],
                 N=B.smooth_normals(M,P)[E['fidx']],tile='outfit',
                 meta={'role':'body','notes':'r26: slim greaves, clean fitted left saddle and right shoulder harness, seams pinned, max29mm.'})
    pp=np.array([sh+axis*t+d*(fit[i,j]+.0015) for i,t in enumerate(ts) for j,d in enumerate(dirs)])
    ff=G.grid_faces(len(ts),len(phis));r=pp[ff].mean(1)-sh;ff=G.orient(pp,ff,G.norm(r-(r@axis)[:,None]*axis))
    uv=np.stack(np.meshgrid(np.linspace(.53,.88,len(phis)),np.linspace(.902,.918,len(ts))),axis=-1).reshape(-1,2)
    allowed=['spine','chest','neck','clavicle_'+side,'upperarm_'+side,'forearm_'+side]
    W=fitted_weights(pp,D,P,['torso','arm_'+side],allowed)
    save(prefix+'_leather_harness',pp,ff,uv,W,D,'Clean40mm russet right shoulder harness, fitted to smoothed donor surface.')
    for edge_side in (0,-1):
        path=pp.reshape(len(ts),len(phis),3)[edge_side]
        rp,rf=G.tube(path,.0013,6,True)
        rw=fitted_weights(rp,D,P,['torso','arm_'+side],allowed)
        save(prefix+'_harness_trim_'+str(abs(edge_side)),rp,rf,np.tile((.5,.957),(len(rp),1)),rw,D,'Continuous bronze stitch/rolled edge fitted on the clean right leather harness.')
    return P


def hip_drape(D,P):
    M=D.mesh['body'];tree=BVHTree.FromPolygons(P.tolist(),M.F.tolist(),all_triangles=True)
    aa=np.linspace(70,230,CONFIG['drape_angles']+1);tt=np.linspace(0,1,CONFIG['drape_sections']+1)
    pp=[];uu=[];az=[]
    for t in tt:
        for a in aa:
            # A shallow rear/side waist layer clears the pumping thighs; the
            # long separate sash tails carry the larger moving silhouette.
            ang=np.radians(a);hem=.920+.018*np.cos(ang+.4)+.013*np.sin(ang*3+.7)
            z=1.058+(hem-1.058)*t
            d=np.array([np.sin(ang),-np.cos(ang),0.])
            c=np.array([0.,.010,z])
            # Below the pelvis the ray origin lies BETWEEN the legs. Cast from
            # outside inward so the cloth follows the outer, rather than inner,
            # surface of a thigh.
            hit=tree.ray_cast(tuple(c+d*.35),tuple(-d),.36)
            r=float(np.dot(np.array(hit[0])-c,d)) if hit[0] is not None else .153
            # Gentle folds, buried waist root, free hem outside legs.
            r+=.0015+.025*np.sin(t*np.pi/2)+.009*np.sin(ang*7+t*1.7)*np.sin(t*np.pi)
            pp.append(c+r*d);uu.append([.05+.4*(a-aa[0])/(aa[-1]-aa[0]),.902+.017*t]);az.append(a)
    pp=np.array(pp);az=np.array(az);ff=G.grid_faces(len(tt),len(aa))
    ff=G.orient(pp,ff,G.norm(np.c_[pp[ff].mean(1)[:,:2]-[0,.01],np.zeros(len(ff))]))
    W=drape_weights(pp,D,az)
    save('crimson_hip_drape',pp,ff,np.array(uu),W,D,'Short saturated rear/side hip drape; buried waist,existing neighbouring kilt chains,flared hem clears thighs.')
    path=pp.reshape(len(tt),len(aa),3)[-1];rp,rf=G.tube(path,.0015,6,True)
    # Interpolate the exact cloth weights onto the hem, keeping rim and cloth together.
    rw=np.repeat(W.reshape(len(tt),len(aa),-1)[-1],6,axis=0)
    rw=np.vstack([rw,W.reshape(len(tt),len(aa),-1)[-1,0],W.reshape(len(tt),len(aa),-1)[-1,-1]])
    save('crimson_hem_bronze',rp,rf,np.tile((.5,.957),(len(rp),1)),rw,D,'Bronze rolled hem following the crimson hip layer with identical skinning.')


def vest_shell(D,P):
    """A continuous fitted vest face bridges the donor's deep arm-root pits."""
    M=D.mesh['body'];tree=BVHTree.FromPolygons(P.tolist(),M.F.tolist(),all_triangles=True)
    aa=np.linspace(-180,180,36,endpoint=False);tt=np.linspace(0,1,12)
    radii=[];zs=[]
    for t in tt:
        rr=[];zz=[]
        for a in aa:
            ang=np.radians(a);top=1.488+.030*np.sin(ang)**2
            z=1.085+t*(top-1.085);c=np.array([0.,.012,z]);d=np.array([np.sin(ang),-np.cos(ang),0.])
            hit=tree.ray_cast(tuple(c+d*.35),tuple(-d),.36)
            r=float(np.dot(np.array(hit[0])-c,d)) if hit[0] is not None else .12
            rx=np.interp(z,[1.085,1.20,1.32,1.43,1.53],[.128,.109,.124,.150,.145])
            ry=np.interp(z,[1.085,1.20,1.32,1.43,1.53],[.100,.080,.094,.110,.087])
            floor=.95/np.sqrt((np.sin(ang)/rx)**2+(np.cos(ang)/ry)**2)
            rr.append(max(r,floor));zz.append(z)
        radii.append(rr);zs.append(zz)
    fit=np.array(radii);zz=np.array(zs)
    for _ in range(5):
        fit=(4*fit+np.roll(fit,1,axis=1)+np.roll(fit,-1,axis=1))/6
    fit=np.maximum(fit,np.array(radii))
    pp=[]
    for i,t in enumerate(tt):
        for j,a in enumerate(aa):
            ang=np.radians(a);r=min(fit[i,j]+.0065,.165/max(abs(np.sin(ang)),1e-3))
            if i==0:r-=.0050
            if i==len(tt)-1:r-=.0020
            pp.append([r*np.sin(ang),.012-r*np.cos(ang),zz[i,j]])
    pp=np.array(pp);ff=G.grid_faces(len(tt),len(aa),True)
    centre=pp[ff].mean(1);hint=G.norm(np.c_[centre[:,:2]-[0,.012],np.zeros(len(ff))]);ff=G.orient(pp,ff,hint)
    W=fitted_weights(pp,D,P,['torso'],['hips','spine','chest','neck','head','clavicle_L','clavicle_R','upperarm_L','upperarm_R','forearm_L','forearm_R'])
    T.save_part(CONFIG['out'],'r26_vest_shell',P=pp,F=ff,UV=np.tile([.3,.3],(len(ff),3,1)),N=G.normals(pp,ff)[ff],W=W,bones=D.bones,tile='donor_body',meta={'role':'body','mesh':'body','replaces':[],
                'notes':'r26 continuous fitted vest bridges donor arm-root cavities; buried waist, fitted top bevel, spatial teal scales and clean russet/bronze collar.'})
    # Rolled neckline is rooted on the shell, with exactly its skin weights.
    # Four sides make a small bevel, not another large armour part.
    path=pp.reshape(len(tt),len(aa),3)[-1]
    tangent=G.norm(np.roll(path,-1,axis=0)-np.roll(path,1,axis=0))
    a=G.norm(np.cross(tangent,np.array([0.,0,1.])))
    b=G.norm(np.cross(tangent,a));angle=np.arange(4)*np.pi/2
    ring=path[:,None,:]+.0022*(a[:,None,:]*np.cos(angle)[None,:,None]+b[:,None,:]*np.sin(angle)[None,:,None])
    rp=np.concatenate([ring,ring[:1]],axis=0).reshape(-1,3)
    rf=G.grid_faces(len(path)+1,4,True)
    if np.einsum('ij,ij->i',rp[rf[:,0]],np.cross(rp[rf[:,1]],rp[rf[:,2]])).sum()<0:rf=rf[:,[0,2,1]]
    rw=np.repeat(np.vstack([W.reshape(len(tt),len(aa),-1)[-1],W.reshape(len(tt),len(aa),-1)[-1,0]]),4,axis=0)
    save('r27_vest_rolled_edge',rp,rf,np.tile((.5,.957),(len(rp),1)),rw,D,'r27 fitted bronze neckline bevel; same weights as shell edge, no floating trim.')


def extend_sash(D):
    M=D.mesh['body'];fi=M.faces('sash_tails');vi,inv=np.unique(M.F[fi],return_inverse=True)
    P=M.P[vi].copy();bend=1-B.smoothstep(.95,1.015,P[:,2])
    P[:,2]+=(1.015-P[:,2])*CONFIG['tail_shortening']*bend
    # Retain the original topology/root and introduce shallow cloth folds.
    z=P[:,2];t=np.clip((1.015-z)/.66,0,1)
    across=(P[:,1]-.025)/.045
    P[:,0]+=.007*np.sin(across*2.4+t*1.2)*np.sin(np.pi*t)
    # Stagger the lower edge, avoiding the old straight rectangular cut.
    tip=B.smoothstep(.80,1,t)
    P[:,2]+=.022*np.sin(across*1.6+.4)*tip
    full=M.P.copy();full[vi]=P
    allowed=[b for b in D.bones if b=='hips' or b.startswith('kilt_')]
    W=B.transfer_surface_weights(P,D,['sash_tails'],allowed)
    T.save_part(CONFIG['out'],'sash_mid_thigh',P=P,F=inv.reshape(-1,3),UV=M.UV[fi],N=B.smooth_normals(M,full)[fi],
                W=W,bones=D.bones,tile='donor_body',meta={'role':'body','mesh':'body','replaces':['sash_tails'],
                'notes':'r27 folded crimson tails with angled lower edges and retained closed thickness; original buried roots and hips+kilt chain weights.'})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-out',default=os.path.join(T.TEAM,'r27','preview1'))
    parser.add_argument('--qa-out')
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    args=parser.parse_args(argv);preview_out=args.preview_out
    iteration=os.path.basename(os.path.normpath(preview_out)).replace('preview','')
    qa_out=args.qa_out or os.path.join(T.ROOT,'progress','shots','hero-seraphine','r27-fix','costume',iteration,'qa')
    # Keep PNG generation in numpy; no imaging library or external image assets.
    D=T.Donor();B.build_outfit(D,CONFIG['out']);fair_torso_edges(D)
    P=shoulder(D)
    # The old teal arm saddle visibly fought the fused skin in engine poses.
    # Keep its fairing, replace the sleeve with two narrow leather harnesses.
    for name in ('shoulder_saddle','shoulder_bronze_rim','shoulder_strap'):
        for ext in ('npz','json'):
            path=os.path.join(CONFIG['out'],name+'.'+ext)
            if os.path.exists(path):os.remove(path)
    P=right_shoulder_strap(D,P,'R');P=right_shoulder_strap(D,P,'L')
    vest_shell(D,P);hip_drape(D,P);extend_sash(D)
    from brann_texture import read_png
    for kind in ('albedo','orm','normal'):
        path=os.path.join(CONFIG['out'],'tiles','outfit_'+kind+'.png')
        arr=read_png(path)[...,:3]*255;h,w=arr.shape[:2];y,x=np.mgrid[0:h,0:w];v=(y+.5)/h;u=(x+.5)/w
        if kind=='albedo':
            # Value ladder: plum leggings > dark leather boots; broad pale
            # cross-wraps / bronze cuffs and a near-black flat sole.
            base=v<.895
            theta=np.where(u<.5,(u-.18)/.29,(u-.68)/.29)
            z=np.clip((v-.035)/.86,0,1)*.565
            grain=2*np.sin(theta*23)+1.5*np.sin(z*105)
            arr[base]=np.array([58,31,23])+grain[base,None]
            phase1=(z/.145+theta*.95)%1
            phase2=(z/.145-theta*.95+.15)%1
            wraps=base&(z>.105)&(z<.445)&((phase1<.18)|(phase2<.18))
            arr[wraps]=[169,139,96]
            arr[base&(z>.445)&(z<.475)]=[155,105,45]
            arr[base&(z>.475)]=[94,57,36]
            arr[base&(z<.035)]=[29,20,19]
            toe=base&(z>.055)&(z<.092)
            arr[toe]=[138,105,65]
            arr[(v>.898)&(v<.921)]=[164,20,43]
            arr[(v>.921)&(v<.936)]=[31,92,80]
            arr[(v>.898)&(v<.921)&(u>.50)]=[100,54,27]
        elif kind=='orm':
            base=v<.895
            arr[base]=[255,210,0]
            z=np.clip((v-.035)/.86,0,1)*.565
            arr[base&(z>.445)&(z<.475)]=[255,158,115]
            arr[(v>.898)&(v<.921)]=[255,182,0]
            arr[(v>.921)&(v<.936)]=[255,155,15]
        B.write_png(path,arr[::-1])
    E=T.load_edits(CONFIG['out']);audit=T.audit_edits(D,E,'body')
    T.save_json(os.path.join(T.TEAM,'r27','costume_audit.json'),audit)
    assert audit['ok'],audit
    print('[seraphine-r27] costume part ready for preview '+json.dumps(audit),flush=True)
    # Head/hair are owned by the parallel head fixer and never rebuilt here.
    import build_hero_seraphine_team as assembler
    sys.argv=[__file__,'--','--integrate','--fast','--out',preview_out]
    assembler.main()
    # QA in the same short slot avoids another trip through the shared queue.
    sys.argv=[__file__,'--','--glb',os.path.join(preview_out,'hero_seraphine.glb'),'--out',qa_out]
    runpy.run_path(os.path.join(T.TEAM,'texture','qa_texture.py'),run_name='__main__')
