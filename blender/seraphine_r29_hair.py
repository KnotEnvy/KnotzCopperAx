"""r29 auburn mane: body-fitted support, sculpted guide locks, left-front plait.
Numpy/Pillow authoring; export with the shared builder through blender-run.
"""
import argparse
import json
import sys
import time
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline
from PIL import Image
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import seraphine_r29_team as T
import seraphine_r29_armour as A

CONFIG={
    'seed':29032,'budget':22000,'shell_offset':.003,'crown_lift':.019,
    'mane_bottom':1.15,'mane_locks':9,'lock_rows':30,'lock_sides':16,
    'braid':{'side':'L','x':.135,'bottom':1.055,'pitch':.073,'radius_root':.028,'radius_tip':.014,'sides':16,'rows':40},
    'circlet':{'width':.006,'disc_radius':.012},
    'palette':{'hair':[117,43,25],'highlight':[163,75,43],'gold':[198,153,72]},
}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--frozen',action='store_true');ap.add_argument('--out',default=str(Path(T.PARTS_DIR)/'hair'))
    ap.add_argument('--preview',nargs='?',const='all');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true')
    a=ap.parse_args();B=T.load_body(frozen=a.frozen)
    if not B['ckpt'] or B['ckpt']['ckpt']<1:raise RuntimeError('B1 is required before building hair')
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True);build(B,T.Rig(),out)


def hair_uv(uv,kind='lock',lane=0):
    uv=np.asarray(uv,float).copy()
    if kind=='gold':uv=uv*[.042,.13]+[.945,.04]
    elif kind=='dark':uv=uv*[.045,.90]+[.88,.05]
    elif kind=='fringe':uv=uv*[.16,.90]+[.70,.05]
    else:uv=uv*[.62,.90]+[.035,.05]
    return uv


def save(name,m,B,out,weights=None,alpha=False,notes=''):
    m=A.orient(m)
    # Root-only parts rigidly follow the head, never the neck or an arm.
    bones=T.HAIR_BONES
    if weights is None:
        W=np.zeros((len(m['P']),len(bones)));W[:,0]=1
    else:W=weights
    # Scalp attachments use actual body vertices for deterministic contact at B1/B2.
    if name in ['under_volume','locks','locks_back','circlet','sun_disc']:
        dist,near=A.cKDTree(B['P']).query(m['P']);i=int(dist.argmin())
        if .0029<dist[i]<.015:
            q=B['P'][near[i]];m['P'][i]=q+A.unit(m['P'][i]-q)*.002
    _,inv=np.unique(np.round(m['P'],8),axis=0,return_inverse=True)
    pp=np.zeros((int(inv.max())+1,3));ww=np.zeros((len(pp),len(bones)));count=np.zeros(len(pp))
    np.add.at(pp,inv,m['P']);np.add.at(ww,inv,W);np.add.at(count,inv,1)
    m['P']=pp/count[:,None];W=ww/count[:,None];m['F']=inv[m['F']]
    if name in ['under_volume','locks','locks_back','circlet','sun_disc']:
        distance,_=A.cKDTree(B['P']).query(m['P']);anchor=int(distance.argmin())
        order=np.r_[anchor,np.arange(len(m['P']))[np.arange(len(m['P']))!=anchor]]
        rev=np.empty(len(order),int);rev[order]=np.arange(len(order))
        m['P']=m['P'][order];W=W[order];m['F']=rev[m['F']]
    return T.save_part(str(out),name,P=m['P'],F=m['F'],UV=m['UV'],N=T.normals_smooth(m['P'],m['F']),W=W,bones=bones,tile='groom',
        meta={'role':'hair','mesh':'groom','alpha':True,'notes':notes,'body_sha':B['ckpt'].get('body_sha')})


def make_tiles(out):
    size=2048;rng=np.random.default_rng(CONFIG['seed']);y,x=np.mgrid[0:size,0:size];u=x/(size-1);v=1-y/(size-1)
    # Hair pigment is present even under alpha, eliminating white mip specks without a white background.
    wave=.006*np.sin(v*12)+.003*np.sin(v*29)
    phase=(u+wave)*2*np.pi
    strands=.021*np.sin(phase*91)+.017*np.sin(phase*217+.6*np.sin(v*18))+.012*np.sin(phase*411)
    group=.065*np.cos(phase*15+.3*np.sin(v*9))+.035*np.sin(v*15+u*7)
    val=1+strands+group+.014*rng.normal(size=(size,size))
    col=np.array(CONFIG['palette']['hair']);rgb=np.clip(col[None,None]*val[:,:,None],0,255)
    alpha=np.full((size,size),255.)
    # Shared mask strip: tapered tips, fine broken edges, pigment already dilated across the entire atlas.
    fringe=(u>=.70)&(u<=.86);U=np.clip((u-.70)/.16,0,1);V=np.clip((v-.05)/.90,0,1)
    width=.48*(.1+.9*np.minimum(1,V*4))
    edge=np.abs(U-.5)-width+.012*np.sin(V*43+U*15)
    strandcut=.045*np.sin(U*240+V*21)+.02*np.sin(U*490+V*8)
    alpha[fringe]=np.clip((-.015-edge[fringe]+strandcut[fringe])/.018+.5,0,1)*255
    dark=(u>.88)&(u<.93);rgb[dark]*=.94
    gold=u>=.94;rgb[gold]=np.array(CONFIG['palette']['gold'])*(1+.04*np.sin(v[gold,None]*80))
    alpha[gold]=255
    rough=np.clip(.69+.07*np.sin(phase*15),.57,.8);metal=np.zeros_like(rough);rough[gold]=.4;metal[gold]=.85
    orm=np.stack([np.ones_like(rough)*255,rough*255,metal*255],-1)
    dx=.028*np.cos(phase*91)+.012*np.cos(phase*217);dy=.025*np.sin(v*30)
    norm=A.unit(np.stack([dx,dy,np.ones_like(dx)],-1));normal=(norm+1)*127.5
    out=Path(out)/'tiles';out.mkdir(parents=True,exist_ok=True)
    Image.fromarray(np.uint8(np.dstack([rgb,alpha])),'RGBA').save(out/'groom_albedo.png')
    Image.fromarray(np.uint8(orm)).save(out/'groom_orm.png');Image.fromarray(np.uint8(normal)).save(out/'groom_normal.png')


def scalp(B):
    cent=B['P'][B['F']].mean(1);S=A.Surface(B,cent[:,2]>1.55)
    crown=B['P'][:,2].max();head=B['P'][B['P'][:,2]>crown-.12]
    center=np.array([0.,(head[:,1].min()+head[:,1].max())*.5,crown-.103])
    return S,center,crown


def scalp_points(S,center,theta,phi,offset=.003):
    th,ph=np.broadcast_arrays(theta,phi)
    d=np.stack([np.sin(th)*np.sin(ph),-np.cos(th)*np.sin(ph),np.cos(ph)],-1)
    return S.cast(np.broadcast_to(center,d.shape),d,offset),d


def build_under_volume(B,S,C):
    theta=np.linspace(-np.pi,np.pi,65);t=np.linspace(.025,1,16)[:,None]
    # The front hairline ends above the brow; the sides/back extend over the ear tops.
    end=.80+1.02*(1-np.cos(theta))/2+.24*np.abs(np.sin(theta))
    phi=t*end[None];th=np.broadcast_to(theta,phi.shape)
    p,d=scalp_points(S,C,th,phi,.003)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),np.linspace(0,1,len(t))),-1)
    return A.grid(p,hair_uv(uv,'dark'),d)


def lock_mesh(path,width,thickness,normal,rows=30,sides=16,kind='lock',taper=True):
    t=np.linspace(0,1,rows);path=np.asarray(path,float)
    curve=CubicSpline(np.linspace(0,1,len(path)),path)(t)
    if np.asarray(normal).ndim==1:n=np.tile(normal,(rows,1))
    else:n=CubicSpline(np.linspace(0,1,len(normal)),normal)(t)
    tangent=A.unit(np.gradient(curve,axis=0));n=A.unit(n-tangent*np.sum(n*tangent,axis=1)[:,None]);across=A.unit(np.cross(tangent,n))
    width=np.broadcast_to(width,len(path)) if np.ndim(width)==0 else np.asarray(width)
    wr=CubicSpline(np.linspace(0,1,len(width)),width)(t)
    if taper:wr*=np.maximum(.018,np.minimum(1,(1-t)*5))
    depth=np.broadcast_to(thickness,len(path)) if np.ndim(thickness)==0 else np.asarray(thickness)
    dep=CubicSpline(np.linspace(0,1,len(depth)),depth)(t)
    if taper:dep*=np.maximum(.06,np.minimum(1,(1-t)*5))
    ang=np.linspace(0,2*np.pi,sides+1)
    # Lens section: a low spine and thin edges, never a round tube.
    P=curve[:,None]+across[:,None]*np.cos(ang)[None,:,None]*wr[:,None,None]+n[:,None]*np.sin(ang)[None,:,None]*dep[:,None,None]
    U,V=np.meshgrid((1+np.cos(ang))/2,1-t)
    m=A.grid(P,hair_uv(np.stack([U,V],-1),kind),P-curve[:,None])
    return m,curve,across,n


def build_locks(B,S,C,crown):
    pieces=[];guides=[]
    xs=[-.119,-.089,-.058,-.025,.012,.048,.081,.110,.128]
    widths=[.032,.038,.043,.044,.045,.041,.037,.032,.026]
    bottoms=[1.29,1.22,1.175,1.21,1.16,1.19,1.235,1.265,1.31]
    for i,(x,w,bottom) in enumerate(zip(xs,widths,bottoms)):
        # Smooth continuous guides from the crown around the occiput into the mane.
        # No piecewise snap from scalp coordinates to a vertical back curtain.
        wave=.014*np.sin(i*1.3)
        path=np.array([[.015+.004*(i-4),-.043+.007*i,crown-.006],
                       [x*.40,.006+.006*i,crown+.010-abs(x)*.05],
                       [x*.83,.079+.008*np.cos(i),1.714],
                       [x+wave,.108+.012*np.sin(i*.7),1.621],
                       [x-wave,.124+.014*np.cos(i),1.514],
                       [x+wave*1.2,.139+.012*np.sin(i),1.402],
                       [x-wave,.132+.010*np.cos(i),1.294],
                       [x*.83+wave,.113,bottom]])
        # Early outer points follow the actual skull's radius with 12-20mm crown lift.
        path[0]=S.cast(np.array([C]),A.unit(path[0]-C)[None],-.002)[0]
        for j in [1,2]:
            direction=A.unit(path[j]-C);fit=S.cast(np.array([C]),direction[None],.003)[0]
            path[j]=fit+direction*(.013 if j==1 else .017)
        normals=np.array([[0,-.3,1],[0,.2,1],[x*4,.7,.6],[x*4,1,.2],[x*4,1,.08],[x*4,1,0],[x*4,1,0],[x*4,1,0]])
        width=np.array([w*.48,w*.83,w,w*.92,w,w*.92,w*.75,.001])
        m,curve,across,n=lock_mesh(path,width,[.004,.009,.010,.010,.010,.009,.007,.001],normals,rows=23,sides=16)
        pieces.append(m);guides.append((curve,across,n,w))
    for side in [-1,1]:
        for layer in range(2):
            # Forehead sweep follows a broad curved wave, then opens at the outer eye.
            path=np.array([[.023,-.074,crown-.004],
                           [side*.018,-.108,crown+.002-layer*.008],
                           [side*.050,-.120,1.742-layer*.012],
                           [side*.079,-.118,1.711-layer*.012],
                           [side*.101,-.086,1.677-layer*.010],
                           [side*.111,-.039,1.623-layer*.012],
                           [side*.109,-.008,1.562-layer*.020]])
            normals=np.array([[0,-.5,1],[0,-.8,.7],[side*.2,-1,.4],[side*.5,-1,.2],[side*.8,-.7,.1],[side*1.,-.4,0],[side*1.,-.4,0]])
            width=np.array([.010,.029,.035,.032,.027,.020,.001])*(1 if layer==0 else .81)
            path[:,0]+=side*layer*.009;path[:,1]+=layer*.004
            path[0]=S.cast(np.array([C]),A.unit(path[0]-C)[None],-.002)[0]
            m,curve,across,n=lock_mesh(path,width,.007,normals,rows=21,sides=12)
            pieces.append(m);guides.append((curve,across,n,.027))
    # Temple-to-occiput sweeps cover the support in profile and reach the upper ear.
    for side in [-1,1]:
        for layer in range(2):
            shift=.041*layer
            path=np.array([[side*.024,-.018,crown-.008],
                           [side*.063,-.024+shift*.4,1.760],
                           [side*.095,-.029+shift,1.726],
                           [side*.110,-.019+shift,1.679],
                           [side*.112,.008+shift,1.622],
                           [side*.129,.015+shift,1.543],
                           [side*.145,.039+shift,1.451],
                           [side*.132,.063+shift,1.357],
                           [side*.110,.055+shift,1.264+layer*.024]])
            normals=np.array([[side*.3,0,1],[side*.7,0,.7]]+[[side,0,.1]]*7)
            path[0]=S.cast(np.array([C]),A.unit(path[0]-C)[None],-.002)[0]
            width=np.array([.012,.032,.043,.046,.047,.043,.039,.029,.001])
            m,curve,across,n=lock_mesh(path,width,.008,normals,rows=23,sides=12)
            pieces.append(m);guides.append((curve,across,n,.041))
    # A single continuous lifted crown mass overlaps all row roots. Its edge is
    # hidden under the swept locks, avoiding exposed support and a back-crown notch.
    theta=np.linspace(-np.pi,np.pi,33);tt=np.linspace(.025,1,10)[:,None]
    end=.80+.73*(1-np.cos(theta))/2
    ph=tt*end[None];th=np.broadcast_to(theta,ph.shape)
    cp,dd=scalp_points(S,C,th,ph,.003)
    lift=.010+.003*np.cos(th-.4)*np.sin(ph)+.002*np.sin(ph*2)
    cp+=dd*lift[:,:,None]
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),np.linspace(1,0,len(tt))),-1)
    pieces.append(A.grid(cp,hair_uv(uv),dd))
    return A.join(*pieces),guides


def build_fringe(guides):
    pieces=[]
    for i,(curve,across,n,width) in enumerate(guides):
        # A few thin edge ribbons soften each large mass. Their roots are buried in its surface.
        for side in [-1,1]:
            ids=np.linspace(2,len(curve)-1,14).astype(int);p=curve[ids];a=across[ids];nn=n[ids]
            t=np.linspace(0,1,len(p));center=p+a*(side*width*.70*(1-t*.55))[:,None]+nn*.006
            center[0]-=nn[0]*.009
            w=.006*(1-t)+.001
            P=np.stack([center-a*w[:,None],center+a*w[:,None]],1)
            uv=np.stack(np.meshgrid([0,1],np.linspace(1,0,len(p))),-1)
            pieces.append(A.grid(P,hair_uv(uv,'fringe'),nn[:,None]))
    return A.join(*pieces)


def braid_weights(P,rootz=1.65,bottom=1.055):
    z=P[:,2];t=np.clip((rootz-z-.04)/(rootz-bottom-.04),0,1)*5
    low=np.minimum(np.floor(t).astype(int),4);mix=t-low
    W=np.zeros((len(P),6))
    W[np.arange(len(P)),low]=1-mix;W[np.arange(len(P)),low+1]=mix
    return W


def build_braid(B,S,C):
    cfg=CONFIG['braid'];path=np.array([[.085,-.052,1.650],[.108,-.055,1.59],[.142,-.073,1.51],
        [.158,-.102,1.445],[.151,-.145,1.37],[.135,-.184,1.29],[.119,-.151,1.20],[.114,-.124,1.105]])
    # Match the visible front of the left chest; braid back touches the fitted body/top.
    cent=B['P'][B['F']].mean(1);torso=A.Surface(B,(cent[:,2]>.99)&(cent[:,2]<1.53)&(cent[:,0]>.04)&(cent[:,0]<.24))
    for i in range(3,len(path)):
        p=torso.cast(np.array([[path[i,0],.18,path[i,2]]]),np.array([[0,-1,0]]),.001,far=True)[0]
        path[i,1]=p[1]-(.024-(i-3)*.0015)
    t=np.linspace(0,1,45);curve=CubicSpline(np.linspace(0,1,len(path)),path)(t)
    arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(curve,axis=0),axis=1))]
    pieces=[]
    # Three-column plait. Alternate LEFT/MIDDLE and MIDDLE/RIGHT crossings;
    # each crossing swaps the strand identities and gives one an over-pass.
    # This is a braid permutation, not three phase-shifted helices.
    step=.038
    steps=int(np.ceil(arc[-1]/step))+1;orders=[[0,1,2]]
    for k in range(steps):
        order=orders[-1].copy();a,b=(0,1) if k%2==0 else (1,2)
        order[a],order[b]=order[b],order[a];orders.append(order)
    for strand in range(3):
        lobes=curve.copy()
        for i,distance in enumerate(arc):
            k=min(int(distance/step),steps-1);q=(distance-k*step)/step
            a,b=(0,1) if k%2==0 else (1,2);order=orders[k];nxt=orders[k+1]
            old=order.index(strand)-1;new=nxt.index(strand)-1
            blend=.5-.5*np.cos(np.pi*q);spread=.014*(1-t[i]*.46)
            lobes[i,0]+=spread*((1-blend)*old+blend*new)
            if old!=new:
                over=-1 if order[a]==strand else 1
                lobes[i,1]+=over*.009*(1-t[i]*.4)*np.sin(np.pi*q)**2
        radii=.014*(1-t*.50)
        m=A.tube(lobes,radii,'gold',16,True)
        uv=m['UV'];a,b,c,d=A.CONFIG['patches']['gold'];local=(uv-[a,b])/[c-a,d-b];m['UV']=hair_uv(local)
        pieces.append(m)
    braid=A.join(*pieces)
    cuffs=[]
    for index in [3,-2]:
        point=curve[index];tangent=A.unit(curve[min(len(curve)-1,index+1)]-curve[max(0,index-1)]) if index>=0 else A.unit(curve[-1]-curve[-3])
        ring=A.tube(np.array([point-tangent*.004,point+tangent*.004]),.026 if index==3 else .014,'gold',24,False)
        a,b,c,d=A.CONFIG['patches']['gold'];ring['UV']=hair_uv((ring['UV']-[a,b])/[c-a,d-b],'gold');cuffs.append(ring)
    tip=curve[-1];tp=np.array([tip,tip+[.002,-.001,-.023],tip+[.006,.004,-.050]])
    tuft,_,_,_=lock_mesh(tp,[.014,.016,.001],[.011,.010,.001],[0,-1,0],rows=9,sides=10)
    return braid,cuffs,tuft,curve


def build_circlet(B,S,C):
    theta=np.linspace(-np.pi,np.pi,65);z=np.array([1.693,1.699])[:,None]+np.zeros((2,len(theta)))
    O=np.stack([np.zeros_like(z),np.zeros_like(z)+C[1],z],-1);th=np.broadcast_to(theta,z.shape)
    D=np.stack([np.sin(th),-np.cos(th),np.zeros_like(th)],-1);p=S.cast(O,D,.0015)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),[0,1]),-1)
    band=A.grid(p,hair_uv(uv,'gold'),D)
    center=S.cast(np.array([[0,C[1],1.697]]),np.array([[0,-1,0]]),.002)[0]
    disc=A.disk(center,.012,(0,-1,0),'gold',24,.003)
    a,b,c,d=A.CONFIG['patches']['gold'];disc['UV']=hair_uv((disc['UV']-[a,b])/[c-a,d-b],'gold')
    return band,disc


def build(B,R,out):
    start=time.monotonic();S,C,crown=scalp(B);reports=[]
    reports.append(save('under_volume',build_under_volume(B,S,C),B,out,notes='Hidden body-fitted scalp support, 3mm offset.'))
    locks,guides=build_locks(B,S,C,crown);reports.append(save('locks',locks,B,out,notes='Nine broad overlapping lens masses plus swept front layers; back ends above waist.'))
    reports.append(save('fringe',build_fringe(guides),B,out,alpha=True))
    braid,cuffs,tuft,curve=build_braid(B,S,C)
    reports.append(save('braid',braid,B,out,braid_weights(braid['P']),notes='ONE LEFT-front plait (+X), three round 16-sided interlacing lobes, head/hair_1..5 only.'))
    for name,m in zip(['cuff_nape','cuff_tip'],cuffs):reports.append(save(name,m,B,out,braid_weights(m['P'])))
    reports.append(save('tuft',tuft,B,out,braid_weights(tuft['P'])))
    circlet,disc=build_circlet(B,S,C)
    for name,m in [('circlet',circlet),('sun_disc',disc)]:reports.append(save(name,m,B,out))
    make_tiles(out)
    report={'role':'hair','body_sha':B['ckpt'].get('body_sha'),'body_ckpt':B['ckpt'],'tris':sum(x['tris'] for x in reports),'parts':{x['name']:x['tris'] for x in reports},'seconds':round(time.monotonic()-start,2),'config':CONFIG,'braid_centerline':curve.tolist()}
    (Path(T.TEAM)/'hair'/'build_report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
    if report['tris']>CONFIG['budget']:raise RuntimeError('Hair budget exceeded')


if __name__=='__main__':main()
