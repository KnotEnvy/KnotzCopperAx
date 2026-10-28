"""r28 fitted costume. One owned Blender job; immutable r27 body baseline.

Replace covered body faces, rather than laying a second vest over ragged skin.
Every opening is split on the same surface and bound on its exact cut contour.
"""
import os, sys, json, argparse, runpy
from pathlib import Path
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seraphine_team as T
import seraphine_body as B
import seraphine_costume_fix as C
import seraphine_groom as G

CONFIG = dict(seed=28, out=Path(T.PARTS_DIR)/'body',
              baseline=Path(T.TEAM)/'r28/baseline/parts_body',
              smooth_steps=38, binding_radius=.0042, stitch_radius=.00105,
              leg_z=[.12,.24,.36,.48,.565,.66,.78,.90,1.015,1.06],
              leg_rx=[.045,.044,.050,.046,.048,.046,.052,.065,.078,.086],
              leg_ry=[.050,.047,.052,.050,.056,.057,.063,.074,.086,.093])


def store(name,P,F,U,W,D,note,replaces=(),tile='donor_body',N=None):
    P=np.asarray(P);F=np.asarray(F,dtype=np.int32)
    if N is None:N=G.normals(P,F)[F]
    T.save_part(str(CONFIG['out']),name,P=P,F=F,UV=np.asarray(U),N=N,W=np.asarray(W),
                bones=D.bones,tile=tile,meta=dict(role='body',mesh='body',replaces=list(replaces),notes=note))


def stable_tube(path,radius,sides=4,closed=False):
    """Parallel-transport section: the shared tube collapses on Y tangents."""
    path=np.asarray(path);n=len(path)
    tangent=G.norm(np.roll(path,-1,axis=0)-np.roll(path,1,axis=0)) if closed else G.norm(np.gradient(path,axis=0))
    a=np.zeros_like(path)
    ref=np.array([0.,0,1]) if abs(tangent[0,2])<.8 else np.array([0.,1,0])
    a[0]=G.norm(np.cross(tangent[0],ref))
    for i in range(1,n):
        v=a[i-1]-tangent[i]*(a[i-1]@tangent[i])
        if np.linalg.norm(v)<1e-6:v=np.cross(tangent[i],[.3,.7,.2])
        a[i]=G.norm(v)
    b=G.norm(np.cross(tangent,a));angle=np.arange(sides)*2*np.pi/sides
    P=(path[:,None]+radius*(a[:,None]*np.cos(angle)[None,:,None]+b[:,None]*np.sin(angle)[None,:,None])).reshape(-1,3)
    F=[]
    for i in range(n if closed else n-1):
        ni=(i+1)%n
        for j in range(sides):
            k=(j+1)%sides;u,v,w,x=i*sides+j,i*sides+k,ni*sides+k,ni*sides+j
            F.extend([(u,v,w),(u,w,x)])
    if not closed:
        for i,flip in ((0,True),(n-1,False)):
            ci=len(P);centre=path[i]+tangent[i]*(.00012 if flip else -.00024);P=np.vstack([P,centre])
            for j in range(sides):
                tri=(ci,i*sides+j,i*sides+(j+1)%sides)
                F.append(tri[::-1] if flip else tri)
    F=np.array(F,dtype=np.int32)
    if np.einsum('ij,ij->i',P[F[:,0]],np.cross(P[F[:,1]],P[F[:,2]])).sum()<0:F=F[:,[0,2,1]]
    return P,F


def garment_distance(P,D):
    x=np.abs(P[:,0]);z=P[:,2]
    # Scoop neckline rises into solid shoulder straps; cut sleeve follows the
    # arm axis, wrapping underneath the axilla rather than ending in a notch.
    neck=1.487+.106*B.smoothstep(.060,.137,x)
    # Rounded lateral armhole contour in the donor frame. The old arm-axis
    # halfspace accidentally extended sleeves down the A-pose forearms.
    hollow=np.sqrt(np.maximum(0,1-((z-1.475)/.090)**2))
    width=.181-.046*hollow
    width+=np.where(P[:,0]<0,.025,.010)*np.exp(-((z-1.565)/.025)**2)
    return np.minimum.reduce([z-1.10,neck-z,width-x])



def fair_body(D):
    M=D.mesh['body'];E=T.load_edits(str(CONFIG['baseline']));P=M.P.copy();P[E['vidx']]=E['P_new']
    _,first,inv=np.unique(M.pos_id,return_index=True,return_inverse=True)
    pp=P[first].copy();z=pp[:,2];x=np.abs(pp[:,0])
    owned=np.zeros(len(P),bool);owned[M.verts_of('torso','arm_L','arm_R')]=True
    mask=owned[first]*B.smoothstep(1.00,1.035,z)*(1-B.smoothstep(1.56,1.60,z))*(1-B.smoothstep(.22,.31,x))
    mask[np.isin(M.pos_id[first],D.pinned_positions('body'))]=0
    edges=np.unique(np.sort(np.concatenate([inv[M.F[:,[0,1]]],inv[M.F[:,[1,2]]],inv[M.F[:,[2,0]]]]),axis=1),axis=0)
    for _ in range(CONFIG['smooth_steps']):
        acc=np.zeros_like(pp);count=np.zeros(len(pp))
        np.add.at(acc,edges[:,0],pp[edges[:,1]]);np.add.at(acc,edges[:,1],pp[edges[:,0]])
        np.add.at(count,edges.ravel(),1)
        pp+=(acc/np.maximum(count[:,None],1)-pp)*mask[:,None]*.58
    P=pp[inv]
    # Fair the inherited arm-root hollows onto the same fitted chest envelope.
    # This is a replacement surface, so no hidden skin remains underneath it.
    z=P[:,2];rad=P[:,:2]-[0,.012]
    rx=np.interp(z,[1.10,1.25,1.35,1.44,1.54],[.127,.112,.13,.154,.145])
    ry=np.interp(z,[1.10,1.25,1.35,1.44,1.54],[.095,.087,.100,.111,.087])
    rr=np.sqrt((rad[:,0]/rx)**2+(rad[:,1]/ry)**2)
    fit=owned*B.smoothstep(1.10,1.26,z)*(1-B.smoothstep(1.50,1.55,z))*(1-B.smoothstep(.16,.20,np.abs(P[:,0])))
    # Replace crumpled armour relief by a smooth leather envelope. Retain a
    # small positive radial derivative so layered donor triangles never fold
    # onto exactly coincident points.
    cloth=B.smoothstep(-.025,.008,garment_distance(P,D))
    shell=1+.055*(rr-1)
    amount=owned*cloth*(1-B.smoothstep(1.52,1.56,z))
    P[:,:2]+=rad*(shell/np.maximum(rr,1e-7)-1)[:,None]*amount[:,None]
    # Keep the head interface exactly pinned. All changes are in replacement
    # body parts; no face, rig, joint or retarget data is written.
    pin=np.isin(M.pos_id,D.pinned_positions('body'));P[pin]=M.P[pin]
    return P


def fitted_legs(D,P):
    M=D.mesh['body'];report={}
    for side in ('L','R'):
        fi=M.faces('leg_'+side);vi=np.unique(M.F[fi]);z=P[vi,2]
        a,b,c=D.joints['foot_'+side],D.joints['shin_'+side],D.joints['thigh_'+side]
        t=np.clip((z-a[2])/(b[2]-a[2]),0,1);centre=a[None]+t[:,None]*(b-a)
        t=np.clip((z-b[2])/(c[2]-b[2]),0,1)
        centre=np.where((z>b[2])[:,None],b[None]+t[:,None]*(c-b),centre)
        rad=P[vi,:2]-centre[:,:2]
        rx=np.interp(z,CONFIG['leg_z'],CONFIG['leg_rx']);ry=np.interp(z,CONFIG['leg_z'],CONFIG['leg_ry'])
        r=np.sqrt((rad[:,0]/rx)**2+(rad[:,1]/ry)**2)
        amount=B.smoothstep(.10,.16,z)*(1-B.smoothstep(.99,1.055,z))
        # Below hip the leather hugs thigh/knee/calf; suppress both outward
        # crumples and capri flares, while retaining the planted flat feet.
        target=np.maximum(.75,1+(r-1)*.18)
        q=P[vi].copy();q[:,:2]+=rad*(target/np.maximum(r,1e-8)-1)[:,None]*amount[:,None]
        P[vi]=q
        report[side]={'max_move_mm':float(np.linalg.norm(q-M.P[vi],axis=1).max()*1000)}
        _,idx=np.unique(M.pos_id,return_index=True);P=P[idx][np.unique(M.pos_id,return_inverse=True)[1]]
        pins=np.isin(M.pos_id,D.pinned_positions('body'));P[pins]=M.P[pins]
        used,inv=np.unique(M.F[fi],return_inverse=True)
        store('r28_fitted_leg_'+side,P[used],inv.reshape(-1,3),M.UV[fi],M.Wn[used],D,
              'r28 fitted smooth jewel-leather leg with flat donor feet and exact original skin weights.',('leg_'+side,),N=B.smooth_normals(M,P)[fi])
        # Outer-leg double seam/piping, attached to the fitted leg BVH.
        from mathutils.bvhtree import BVHTree
        tree=BVHTree.FromPolygons(P.tolist(),M.F[fi].tolist(),all_triangles=True)
        path=[];sgn=1 if side=='L' else -1
        for h in np.linspace(.575,1.025,23):
            hit=tree.ray_cast((sgn*.35,.008,float(h)),(-sgn,0,0),.35)
            if hit[0] is not None:path.append(np.array(hit[0])+np.array([sgn*.0005,0,0]))
        if len(path)>3:
            rp,rf=stable_tube(np.array(path),.0042,6)
            rw=C.fitted_weights(rp,D,P,['leg_'+side],['hips','thigh_'+side,'shin_'+side])
            store('r28_outer_piping_'+side,rp,rf,np.tile([.5,.957],(len(rf),3,1)),rw,D,
                  'r28 narrow bronze outer panel seam; attached to fitted leather, not a pale trouser mass.',tile='outfit')
    return P,report


def clean_upper_arms(D,P):
    """Replace the fused armour flaps inside the armholes by round skin.

    Roots bury under the shoulder binding, distal rings overlap the retained
    healthy arm above the elbow. This removes the old flesh-coloured wedges.
    """
    from mathutils.bvhtree import BVHTree
    M=D.mesh['body']
    for side in ('L','R'):
        sh=D.joints['upperarm_'+side];el=D.joints['forearm_'+side]
        axis=G.norm(el-sh);length=np.linalg.norm(el-sh)
        up=G.norm(np.array([0.,0,1])-axis*axis[2]);front=G.norm(np.cross(axis,up))
        tree=BVHTree.FromPolygons(P.tolist(),M.F[M.faces('arm_'+side)].tolist(),all_triangles=True)
        ts=np.linspace(-.105,.245,18);angles=np.arange(20)*2*np.pi/20
        pp=[];ww=[]
        for t in ts:
            c=sh+axis*t;radius=np.interp(t,[-.105,-.085,-.055,-.005,.075,.16,.245],[.001,.030,.047,.058,.055,.046,.040])
            for angle in angles:
                d=up*np.cos(angle)+front*np.sin(angle)
                hit=tree.ray_cast(tuple(c+d*.15),tuple(-d),.2)
                actual=float(np.dot(np.array(hit[0])-c,d)) if hit[0] is not None else radius
                mix=B.smoothstep(.200,.240,t)
                r=radius*(1-mix)+(max(actual,.026)+.0005)*mix
                pp.append(c+d*r)
                arm=B.smoothstep(-.045,.035,t);fore=B.smoothstep(length-.09,length+.03,t)*.42
                w=np.zeros(len(D.bones))
                w[D.bones.index('chest')]=(1-arm)*.72
                w[D.bones.index('clavicle_'+side)]=(1-arm)*.28
                w[D.bones.index('upperarm_'+side)]=arm*(1-fore)
                w[D.bones.index('forearm_'+side)]=arm*fore
                ww.append(w)
        pp=np.array(pp);ff=G.grid_faces(len(ts),len(angles),True)
        rel=pp[ff].mean(1)-sh;hint=G.norm(rel-(rel@axis)[:,None]*axis)
        ff=G.orient(pp,ff,hint)
        # A buried rounded cap closes the proximal end. An open ring exposed
        # a dark crescent above the old shoulder surface in the A-pose.
        cap=len(pp);pp=np.vstack([pp,sh+axis*ts[0]])
        cf=np.array([(cap,j,(j+1)%len(angles)) for j in range(len(angles))])
        cf=G.orient(pp,cf,np.tile(-axis,(len(cf),1)))
        ff=np.vstack([ff,cf]);ww.append(ww[0].copy())
        store('r28_clean_upperarm_'+side,pp,ff,np.tile([.28,.28],(len(ff),3,1)),ww,D,
              'r28 smooth anatomical upper-arm replacement: buried shoulder root, local adjacent weights, overlap healthy elbow; old fused flesh flaps removed.')


def regular_vest(D):
    """Tailored torso shell + joined straps: no inherited folded armour faces."""
    angles=np.arange(72)*2*np.pi/72;az=np.degrees(angles)
    folded=np.minimum(az,360-az)
    top=1.489-.087*np.sin(angles)**2
    top+=.078*(np.exp(-((folded-45)/18)**2)+np.exp(-((folded-135)/18)**2))
    pp=[]
    for t in np.linspace(0,1,18):
        z=1.10+t*(top-1.10)
        rx=np.interp(z,[1.10,1.25,1.35,1.44,1.54],[.127,.112,.13,.154,.145])
        ry=np.interp(z,[1.10,1.25,1.35,1.44,1.54],[.095,.087,.100,.111,.087])
        pp.extend(np.c_[(rx+.0015)*np.sin(angles),.012-(ry+.0015)*np.cos(angles),z])
    pp=list(np.array(pp));ff=list(G.grid_faces(18,72,True));base=17*72
    for sign in (1,-1):
        front=[int((i*sign)%72) for i in range(7,12)]
        back=[int((i*sign)%72) for i in range(29,24,-1)]
        start=np.array([pp[base+i] for i in front]);end=np.array([pp[base+i] for i in back])
        rows=[np.array([base+i for i in front])]
        for t in np.linspace(0,1,11)[1:-1]:
            p=start*(1-t)+end*t
            p[:,0]+=sign*.022*np.sin(np.pi*t)
            p[:,2]+=.036*np.sin(np.pi*t)
            rows.append(np.arange(len(pp),len(pp)+len(front)));pp.extend(p)
        rows.append(np.array([base+i for i in back]));rows=np.array(rows)
        sf=G.grid_faces(len(rows),len(front));ff.extend(rows.ravel()[sf])
    pp=np.array(pp);ff=np.array(ff)
    outward=pp[ff].mean(1)-[0,.012,0];outward[:,2]=0
    ff=G.orient(pp,ff,G.norm(outward))
    # The straps have upward-facing top surfaces.
    topfaces=np.arange(len(ff))>=17*72*2
    ff[topfaces]=G.orient(pp,ff[topfaces],np.tile([0,0,1.],(topfaces.sum(),1)))
    z=pp[:,2];W=np.zeros((len(pp),len(D.bones)))
    a=B.smoothstep(1.07,1.24,z);b=B.smoothstep(1.24,1.43,z)
    W[:,D.bones.index('hips')]=1-a;W[:,D.bones.index('spine')]=a*(1-b);W[:,D.bones.index('chest')]=a*b
    shoulder=B.smoothstep(.10,.18,np.abs(pp[:,0]))*B.smoothstep(1.48,1.55,z)*.28
    W*=1-shoulder[:,None]
    for side,sel in [('L',pp[:,0]>=0),('R',pp[:,0]<0)]:
        W[sel,D.bones.index('clavicle_'+side)]+=shoulder[sel]*.75
        W[sel,D.bones.index('upperarm_'+side)]+=shoulder[sel]*.25
    store('r28_regular_vest',pp,ff,np.tile([.3,.3],(len(ff),3,1)),W,D,
          'r28 regular fitted scale-leather shell with joined solid shoulder straps; covered folded donor armour entirely removed.')
    # Smooth exposed upper chest from the preserved neck down to the garment
    # opening. Old fused armour left tiny teeth even above its former collar.
    from mathutils.bvhtree import BVHTree
    M=D.mesh['body'];Q=M.P.copy();face=T.load_edits(os.path.join(T.PARTS_DIR,'face'))
    if face is not None:Q[face['vidx']]=face['P_new']
    tree=BVHTree.FromPolygons(Q.tolist(),M.F.tolist(),all_triangles=True)
    inner=[]
    for angle in angles:
        direction=np.array([np.sin(angle),-np.cos(angle),0.]);c=np.array([0.,.012,1.568])
        hit=tree.ray_cast(tuple(c),tuple(direction),.15)
        radius=max(.025,float(hit[3])-.0015) if hit[0] is not None else .034
        inner.append(c+direction*radius)
    inner=np.array(inner);outer=pp[base:base+72].copy();rad=G.norm(outer-[0,.012,0]);rad[:,2]=0
    outer[:,:2]-=rad[:,:2]*.0015;outer[:,2]-=.002
    innerW=C.fitted_weights(inner,D,Q,['torso','head'],['chest','neck','head','clavicle_L','clavicle_R'])
    skinP=[];skinW=[]
    for t in np.linspace(0,1,10):
        skinP.extend(inner*(1-t)+outer*t);skinW.extend(innerW*(1-t)+W[base:base+72]*t)
    skinP=np.array(skinP);skinF=G.grid_faces(10,72,True)
    hint=skinP[skinF].mean(1)-[0,.012,1.30]
    skinF=G.orient(skinP,skinF,G.norm(hint))
    store('r28_clean_collar_skin',skinP,skinF,np.tile([.26,.26],(len(skinF),3,1)),skinW,D,
          'r28 smooth exposed collar skin from buried preserved neck to garment edge, exact edge weights; old jagged underlayer removed.')
    # Exact mesh boundary loops: neckline, both armholes, waist hem.
    edges=np.sort(np.concatenate([ff[:,[0,1]],ff[:,[1,2]],ff[:,[2,0]]]),axis=1)
    edges,count=np.unique(edges,axis=0,return_counts=True);adj={}
    for x,y in edges[count==1]:adj.setdefault(x,set()).add(y);adj.setdefault(y,set()).add(x)
    used=set();loops=[]
    for start in adj:
        if all(frozenset((start,n)) in used for n in adj[start]):continue
        line=[start];cur=start
        while True:
            choices=[n for n in adj[cur] if frozenset((cur,n)) not in used]
            if not choices:break
            n=choices[0];used.add(frozenset((cur,n)));line.append(n);cur=n
            if cur==start:break
        loops.append(line)
    for i,line in enumerate(loops):
        path=pp[line];weights=W[line]
        arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(path,axis=0),axis=1))]
        at=np.linspace(0,arc[-1],min(73,max(8,int(arc[-1]/.011)+1)))
        q=np.array([np.interp(at,arc,path[:,j]) for j in range(3)]).T[:-1]
        ww=np.array([np.interp(at,arc,weights[:,j]) for j in range(len(D.bones))]).T[:-1]
        rp,rf=stable_tube(q,.0035,6,closed=True);rw=np.repeat(ww,6,axis=0)
        store('r28_regular_binding_'+str(i),rp,rf,np.tile([.5,.957],(len(rf),3,1)),rw,D,
              'r28 continuous attached bronze rolled binding on regular garment mesh boundary; exact garment edge skinning.',tile='outfit')
    return {'loops':len(loops),'tris':len(ff)}


def build_vest(D,P):
    M=D.mesh['body'];fi=M.faces('torso','arm_L','arm_R');distance=garment_distance(P,D)
    newP=[];newW=[];newF=[];newUV=[];cache={};segments=[]
    # Old fused armour carried upper-arm weights down the vest side. Use a
    # continuous torso field for cloth and its skin boundary; distal bare arms
    # keep their donor weights.
    surfW=M.Wn.copy();local=np.zeros_like(surfW);z=P[:,2]
    spine=B.smoothstep(1.07,1.24,z);chest=B.smoothstep(1.24,1.43,z)
    local[:,D.bones.index('hips')]=1-spine
    local[:,D.bones.index('spine')]=spine*(1-chest)
    local[:,D.bones.index('chest')]=spine*chest
    shoulder=B.smoothstep(.10,.18,np.abs(P[:,0]))*B.smoothstep(1.46,1.55,z)*.45
    local*=1-shoulder[:,None]
    for side,sel in [('L',P[:,0]>=0),('R',P[:,0]<0)]:
        local[sel,D.bones.index('clavicle_'+side)]+=shoulder[sel]*.7
        local[sel,D.bones.index('upperarm_'+side)]+=shoulder[sel]*.3
    blend=B.smoothstep(-.026,.009,distance)
    blend*=B.smoothstep(1.075,1.12,z)
    surfW=surfW*(1-blend[:,None])+local*blend[:,None]
    surfW/=np.maximum(surfW.sum(1,keepdims=True),1e-12)
    # Vertex IDs include only position+weights, UVs stay per corner. Adjacent
    # garment and skin faces therefore share their exact physical cut edge.
    def vertex(point,weight):
        key=tuple(np.round(point,9))
        if key not in cache:cache[key]=len(newP);newP.append(point);newW.append(weight)
        return cache[key]
    for f in fi:
        ids=M.F[f];tri=[(P[j],surfW[j],uv,float(distance[j])) for j,uv in zip(ids,M.UV[f])]
        crossing=[]
        for j in range(3):
            a,b=tri[j],tri[(j+1)%3]
            if (a[3]>=0)!=(b[3]>=0):
                t=a[3]/(a[3]-b[3]);crossing.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
        if len(crossing)==2:segments.append(crossing)
        for garment in (False,True):
            poly=[]
            for j in range(3):
                a,b=tri[j],tri[(j+1)%3];ina=(a[3]>=0)==garment;inb=(b[3]>=0)==garment
                if ina:poly.append(a)
                if ina!=inb:
                    t=a[3]/(a[3]-b[3]);poly.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3))+(0.,))
            for j in range(1,len(poly)-1):
                tt=[poly[0],poly[j],poly[j+1]]
                if np.linalg.norm(np.cross(tt[1][0]-tt[0][0],tt[2][0]-tt[0][0]))<4e-10:continue
                centre=np.mean([t[0] for t in tt],axis=0)
                if 1.10<centre[2]<1.562 and abs(centre[0])<.205:continue
                if garment and min(t[0][2] for t in tt)<1.48:continue
                if not garment:
                    centre=np.mean([t[0] for t in tt],axis=0);replace=False
                    for side in ('L','R'):
                        sh=D.joints['upperarm_'+side];axis=G.norm(D.joints['forearm_'+side]-sh)
                        rel=centre-sh;along=rel@axis;radial=np.linalg.norm(rel-along*axis)
                        if -.100<along<.232 and radial<.20 and abs(centre[0])>.075:replace=True
                    if replace:continue
                newF.append([vertex(t[0],t[1]) for t in tt])
                newUV.append([[.27,.27]]*3 if garment else [t[2] for t in tt])
    p=np.array(newP);f=np.array(newF);w=np.array(newW)
    store('r28_continuous_vest_body',p,f,newUV,w,D,
          'r28 single fitted garment/skin partition: covered donor body removed, shared exact neckline+armhole boundary; solid shoulder yoke.',('torso','arm_L','arm_R'))
    # Join the exact cut segments into contours. No independent trim floats
    # in front of the body; each tube is centred on the garment/skin edge.
    keys=lambda p:tuple(np.round(p,8));adj={};points={};weights={}
    for seg in segments:
        a,b=[keys(q[0]) for q in seg]
        if a==b:continue
        adj.setdefault(a,set()).add(b);adj.setdefault(b,set()).add(a)
        for k,(q,ww) in zip((a,b),seg):points[k]=q;weights[k]=ww
    used=set();loops=[]
    for start in list(adj):
        for nxt in list(adj[start]):
            if frozenset((start,nxt)) in used:continue
            line=[start];prev=None;cur=start
            while True:
                choices=[n for n in adj[cur] if frozenset((cur,n)) not in used]
                if not choices:break
                nxt=choices[0];used.add(frozenset((cur,nxt)));line.append(nxt);prev,cur=cur,nxt
                if cur==start:break
            if len(line)>3:loops.append(line)
    for i,line in enumerate([]):
        path=np.array([points[k] for k in line]);ww=np.array([weights[k] for k in line])
        if path[:,2].max()<1.45 and path[:,2].min()>1.2:continue
        # The donor triangle cut may contain hundreds of tiny edges. Re-sample
        # by arc length so binding follows the contour without wasting budget.
        arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(path,axis=0),axis=1))]
        count=min(65,max(6,int(np.ceil(arc[-1]/.014))+1))
        at=np.linspace(0,arc[-1],count)
        path=np.array([np.interp(at,arc,path[:,j]) for j in range(3)]).T
        ww=np.array([np.interp(at,arc,ww[:,j]) for j in range(len(D.bones))]).T
        for name,r,uv in [('leather',CONFIG['binding_radius'],[.70,.910])]:
            # Offset the thin bronze thread outward on the leather binding.
            q=path.copy()
            if name=='bronze':
                nn=q.copy();nn[:,2]=0;nn[:,1]-=.012;nn=G.norm(nn);q+=nn*.0034
            closed=np.linalg.norm(q[0]-q[-1])<1e-6
            if closed:
                q=q[:-1];edgeW=ww[:-1]
                rp,rf=stable_tube(q,r,4,closed=True);rw=np.repeat(edgeW,4,axis=0)
            else:
                rp,rf=stable_tube(q,r,4)
                rw=np.vstack([np.repeat(ww,4,axis=0),ww[0],ww[-1]])
            bindUV=np.tile(uv,(len(rf),3,1))
            centres=rp[rf].mean(1);normals=np.cross(rp[rf[:,1]]-rp[rf[:,0]],rp[rf[:,2]]-rp[rf[:,0]])
            outward=centres.copy();outward[:,2]=0;outward[:,1]-=.012
            bronze=np.einsum('ij,ij->i',G.norm(normals),G.norm(outward))>.74
            bindUV[bronze]=[.5,.957]
            store(f'r28_binding_{i}_{name}',rp,rf,bindUV,rw,D,
                  'r28 continuous fitted '+name+' binding on exact neckline/armhole/hem cut, with matching edge weights.',tile='outfit')
    return dict(contours=len(loops),contour_vertices=[len(x) for x in loops],triangles=len(f),covered_body_deleted=True)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--qa-out',required=True)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);D=T.Donor()
    # Rebuild deterministically from the frozen r27 owned part set.
    import shutil
    for name in CONFIG['out'].iterdir():
        if name.is_file():name.unlink()
        elif name.is_dir():shutil.rmtree(name)
    for src in CONFIG['baseline'].iterdir():
        dst=CONFIG['out']/src.name
        if src.is_dir():shutil.copytree(src,dst)
        else:shutil.copy2(src,dst)
    for stem in ('bronze_knee_discs','r26_vest_shell','r27_vest_rolled_edge','right_leather_harness','left_leather_harness','right_harness_trim_0','right_harness_trim_1','left_harness_trim_0','left_harness_trim_1'):
        for ext in ('json','npz'):(CONFIG['out']/(stem+'.'+ext)).unlink(missing_ok=True)
    # Replaced legs carry original UVs; lower-leg outfit re-UV edits would
    # otherwise only affect removed donor triangles. Keep edits for other parts.
    P=fair_body(D);P,legs=fitted_legs(D,P);vest=build_vest(D,P);clean_upper_arms(D,P);vest['regular']=regular_vest(D)
    T.save_json(str(Path(T.TEAM)/'r28/costume_audit.json'),dict(legs=legs,vest=vest))
    print('[seraphine-r28] parts ready '+json.dumps(dict(legs=legs,vest=vest)),flush=True)
    import build_hero_seraphine_team as assembler
    sys.argv=[__file__,'--','--integrate','--fast','--out',args.out];assembler.main()
    sys.argv=[__file__,'--','--glb',os.path.join(args.out,'hero_seraphine.glb'),'--out',args.qa_out]
    runpy.run_path(os.path.join(T.TEAM,'texture/qa_texture.py'),run_name='__main__')

if __name__=='__main__':main()
