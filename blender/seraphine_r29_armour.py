"""r29 armour. Deterministic body-surface fitting, numpy/Pillow only.
Run with ~/kca-assets/venv/bin/python -I blender/seraphine_r29_armour.py [--frozen].
Preview/export is the lead-owned build_hero_seraphine_r29.py through blender-run.
"""
import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import seraphine_r29_team as T

CONFIG = {
    "seed": 29031, "offset": .002, "budget": 16000,
    "top": {"bottom": 1.202, "middle": 1.278, "peak": 1.355, "side": 1.287, "angles": 56, "rows": 12},
    "brief": {"belt": 1.055, "crotch": .795, "side": .935, "angles": 56, "rows": 12},
    "boot": {"top": .487, "fur_height": .047, "angles": 32, "rows": 20, "sole": .014},
    "bracer": {"start": .31, "end": .94, "angles": 28, "rows": 10},
    "cloth": {"top": 1.035, "bottom": .60, "width": .182, "rows": 8, "cols": 12, "front_bottom": .640, "back_bottom": .620, "tip_spring": .62, "back_tip_spring": .50, "standoff": .016},
    "palette": {"bronze": [170,122,65], "leather": [62,38,27], "cloth": [121,30,27],
                "fur": [185,163,133], "gold": [198,153,72], "teal": [20,102,98]},
    "patches": {"scale": [.02,.56,.98,.98], "bronze": [.02,.435,.98,.535],
                "leather": [.02,.315,.98,.415], "cloth": [.02,.14,.98,.295],
                "fur": [.02,.065,.66,.12], "gold": [.70,.065,.98,.12], "teal": [.02,.015,.45,.045]},
}


def unit(a):
    a = np.asarray(a, float)
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def mesh(P,F,UV=None):
    P,F=np.asarray(P,float),np.asarray(F,np.int32)
    if UV is None: UV=np.zeros((len(P),2))
    UV=np.asarray(UV,float)
    return {"P":P,"F":F,"UV":UV[F] if UV.ndim==2 else UV}


def join(*items):
    items=[m for m in items if m is not None and len(m['F'])]
    offset=0; PP=[];FF=[];UU=[]
    for m in items:
        PP.append(m['P']);FF.append(m['F']+offset);UU.append(m['UV']);offset+=len(m['P'])
    return mesh(np.concatenate(PP),np.concatenate(FF),np.concatenate(UU))


def patch_uv(uv, patch):
    a,b,c,d=CONFIG['patches'][patch]
    uv=np.asarray(uv,float)
    return uv*np.array([c-a,d-b])+[a,b]


def grid(P,uv=None,outward=None):
    P=np.asarray(P,float);nr,nc=P.shape[:2]; F=[]
    for j in range(nr-1):
        for i in range(nc-1):
            a=j*nc+i;b=a+1;c=a+nc;d=c+1
            F.extend([(a,b,d),(a,d,c)])
    if uv is None:
        uu,vv=np.meshgrid(np.linspace(0,1,nc),np.linspace(0,1,nr));uv=np.stack([uu,vv],-1)
    m=mesh(P.reshape(-1,3),F,np.asarray(uv).reshape(-1,2))
    if outward is not None:
        n=np.cross(m['P'][m['F'][:,1]]-m['P'][m['F'][:,0]],m['P'][m['F'][:,2]]-m['P'][m['F'][:,0]])
        expected=np.broadcast_to(outward,P.shape).reshape(-1,3)[m['F']].mean(1)
        if (n*expected).sum()<0:
            m['F']=m['F'][:,::-1];m['UV']=m['UV'][:,::-1]
    return m


class Surface:
    """Ray/triangle fit to the supplied body, not an analytic substitute body."""
    def __init__(self,B,mask=None):
        self.B=B
        tri=B['P'][B['F']]
        if mask is not None: tri=tri[mask]
        self.a=tri[:,0];self.e1=tri[:,1]-tri[:,0];self.e2=tri[:,2]-tri[:,0]
        self.n=unit(np.cross(self.e1,self.e2))
        self.cloud=np.unique(tri.reshape(-1,3),axis=0)
        self.tree=cKDTree(self.cloud)
    def cast(self,O,D,offset=.002, far=False):
        shape=np.asarray(O).shape;O=np.asarray(O).reshape(-1,3);D=unit(np.asarray(D).reshape(-1,3));res=[]
        for k in range(0,len(O),32):
            o,d=O[k:k+32],D[k:k+32]
            h=np.cross(d[:,None,:],self.e2[None]);det=(self.e1[None]*h).sum(-1)
            inv=np.divide(1,det,out=np.zeros_like(det),where=np.abs(det)>1e-10)
            s=o[:,None,:]-self.a[None];u=(s*h).sum(-1)*inv
            q=np.cross(s,self.e1[None]);v=(d[:,None,:]*q).sum(-1)*inv
            tt=(self.e2[None]*q).sum(-1)*inv
            valid=(np.abs(det)>1e-10)&(u>=-1e-7)&(v>=-1e-7)&(u+v<=1.0000001)&(tt>=0)
            val=np.where(valid,tt,-np.inf if far else np.inf)
            idx=val.argmax(1) if far else val.argmin(1);dist=val[np.arange(len(o)),idx]
            bad=~np.isfinite(dist)
            p=o+d*np.where(bad,0,dist)[:,None]
            n=self.n[idx]
            n=np.where((n*d).sum(1)[:,None]<0,-n,n)
            p+=n*offset
            if bad.any():
                # A ray can fall just above a ring pole; use the nearest actual surface vertex.
                target=o[bad]+d[bad]*.06
                _,ii=self.tree.query(target);p[bad]=self.cloud[ii]+d[bad]*offset
            res.append(p)
        return np.concatenate(res).reshape(shape)


def tube(path,radius,patch='gold',sides=8,cap=True,depth=None):
    path=np.asarray(path,float);tan=unit(np.gradient(path,axis=0));ref=np.tile([0,1,0],(len(path),1))
    ref[np.abs((tan*ref).sum(1))>.93]=[1,0,0]
    A=unit(np.cross(tan,ref));B=unit(np.cross(tan,A));a=np.linspace(0,2*np.pi,sides+1)
    r=np.broadcast_to(np.asarray(radius),len(path));rd=r if depth is None else np.broadcast_to(depth,len(path))
    P=path[:,None]+A[:,None]*np.cos(a)[None,:,None]*r[:,None,None]+B[:,None]*np.sin(a)[None,:,None]*rd[:,None,None]
    u,v=np.meshgrid(np.linspace(0,1,sides+1),np.linspace(0,1,len(path)))
    m=grid(P,patch_uv(np.stack([u,v],-1),patch),P-path[:,None])
    if cap:
        pp=m['P'].tolist();ff=m['F'].tolist();uv=m['UV'].tolist()
        for row,sgn in [(0,-1),(-1,1)]:
            center=len(pp);pp.append(path[row].tolist());base=0 if row==0 else (len(path)-1)*(sides+1)
            for i in range(sides):
                f=[base+i,center,base+i+1] if sgn<0 else [base+i,base+i+1,center]
                ff.append(f);uv.append(patch_uv([[.4,.4],[.5,.5],[.6,.4]],patch).tolist())
        m=mesh(pp,ff,uv)
    return m


def disk(center,radius,normal=(0,-1,0),patch='gold',n=24,depth=.003):
    normal=unit(normal);ref=np.array([0,0,1.])
    if abs(normal@ref)>.9:ref=np.array([1,0,0.])
    A=unit(np.cross(ref,normal));B=np.cross(normal,A)
    t=np.linspace(0,2*np.pi,n+1)
    rings=[]
    for r,d in [(radius,0),(radius*.88,depth*.8),(radius*.4,depth),(radius*.02,depth)]:
        rings.append(np.asarray(center)+r*(np.cos(t)[:,None]*A+np.sin(t)[:,None]*B)+normal*d)
    uv=np.stack(np.meshgrid(np.linspace(0,1,n+1),np.linspace(0,1,4)),-1)
    return grid(rings,patch_uv(uv,patch),normal)


def make_tiles(out):
    w,h=768,2048;rng=np.random.default_rng(CONFIG['seed'])
    y,x=np.mgrid[0:h,0:w];uvx=x/(w-1);uvy=1-y/(h-1)
    al=np.zeros((h,w,3),float)+[62,38,27];orm=np.zeros((h,w,3),float)+[255,180,0];height=np.zeros((h,w),float)
    for patch,box in CONFIG['patches'].items():
        a,b,c,d=box;mask=(uvx>=a-.005)&(uvx<=c+.005)&(uvy>=b-.005)&(uvy<=d+.005)
        U=(uvx-a)/(c-a);V=(uvy-b)/(d-b)
        colour=CONFIG['palette'].get(patch,CONFIG['palette']['bronze']);base=np.array(colour,float)
        val=1+.025*np.sin(U*440)+.018*rng.normal(size=(h,w))
        relief=np.zeros((h,w))
        rough,metal=.72,0
        if patch=='scale':
            # 36 columns around a 0.75m bust: ~21mm wide scales, alternating two bronze values.
            sy=(1-V)*15;row=np.floor(sy);sx=U*36+.5*(row%2);fx=sx%1;fy=sy%1
            shape=np.sqrt(np.maximum(0,1-((fx-.5)/.55)**2))*.43+.57
            edge=np.abs(fy-shape);inside=fy<shape
            val=np.where(inside,.85+.30*(1-fy)+.13*(np.floor(sx+row)%2),.37)
            val+=.24*np.exp(-(edge/.045)**2)
            val-=.38*np.exp(-(np.minimum(fx,1-fx)/.045)**2)*(fy<.44)
            relief=np.where(inside,.7*(1-fy),0)+.2*np.exp(-(edge/.04)**2)
            rough,metal=.43,.82
        elif patch in ('bronze','gold'):
            val=1+.06*np.sin(U*35)+.035*np.cos(V*33)
            engraving=np.abs(np.sin(U*8*np.pi)+.38*np.sin(V*4*np.pi))
            val-=.23*np.exp(-(engraving/.07)**2)
            relief=-.3*np.exp(-(engraving/.06)**2);rough,metal=.4,.85
        elif patch=='cloth':
            val=1+.09*np.sin(U*29+V*5)+.025*np.sin(U*1800)*np.sin(V*1800)
            val-=.2*(np.minimum(U,1-U)<.025);rough=.85
        elif patch=='fur':
            val=1+.12*np.sin(U*220+V*19)+.04*np.sin(U*680+V*80);relief=.15*np.sin(U*220+V*19);rough=.9
        elif patch=='teal':rough,metal=.28,.35
        elif patch=='leather':
            val+=.04*np.sin(U*600+V*16);relief=.02*rng.normal(size=(h,w));rough=.72
        al[mask]=np.clip(base[None]*val[mask,None],0,255);orm[mask]=[255,rough*255,metal*255];height[mask]=relief[mask]
    gy,gx=np.gradient(gaussian_filter(height,.6));nn=unit(np.stack([-gx*4,gy*4,np.ones_like(gx)],-1));normal=((nn+1)*127.5).astype(np.uint8)
    out=Path(out)/'tiles';out.mkdir(parents=True,exist_ok=True)
    for name,a in [('albedo',al),('orm',orm),('normal',normal)]:Image.fromarray(np.uint8(np.clip(a,0,255))).save(out/f'gear_{name}.png')


def torso_ring(S,theta,z,offset=.002):
    th,z=np.broadcast_arrays(theta,z);O=np.stack([np.zeros_like(z),np.zeros_like(z),z],-1)
    D=np.stack([np.sin(th),-np.cos(th),np.zeros_like(z)],-1)
    return S.cast(O,D,offset),D


def orient(m):
    # Propagate winding over actual welded edges; signed-volume fixes only closed islands.
    _,inv=np.unique(np.round(m['P'],7),axis=0,return_inverse=True);f=inv[m['F']];edges={}
    for i,tri in enumerate(f):
        for a,b in zip(tri,np.roll(tri,-1)):
            if a==b:continue
            key=(min(a,b),max(a,b));edges.setdefault(key,[]).append((i,a<b))
    adj=[[] for _ in f]
    for e in edges.values():
        if len(e)==2:
            (i,sg),(j,tg)=e;adj[i].append((j,sg==tg));adj[j].append((i,sg==tg))
    seen=np.zeros(len(f),bool);flip=np.zeros(len(f),bool)
    for root in range(len(f)):
        if seen[root]:continue
        stack=[root];seen[root]=True;comp=[]
        while stack:
            i=stack.pop();comp.append(i)
            for j,same in adj[i]:
                if not seen[j]:seen[j]=True;flip[j]=flip[i]^same;stack.append(j)
        ids=np.array(comp);ff=m['F'][ids].copy();ff[flip[ids]]=ff[flip[ids],::-1]
        closed=all(len(edges[(min(a,b),max(a,b))])==2 for tri in f[ids] for a,b in zip(tri,np.roll(tri,-1)) if a!=b)
        if closed:
            tri=m['P'][ff];vol=np.einsum('ij,ij->i',tri[:,0],np.cross(tri[:,1],tri[:,2])).sum()/6
            if vol<0:flip[ids]=~flip[ids]
    m['F'][flip]=m['F'][flip,::-1];m['UV'][flip]=m['UV'][flip,::-1]
    tri=m['P'][m['F']];ok=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)>2e-10
    m['F']=m['F'][ok];m['UV']=m['UV'][ok]
    return m


def save(name,m,B,out,weights=None,notes=''):
    # Locate the fastening point on an actual body vertex (not only an interpolated face).
    # This preserves a measured 2mm attachment even for coarse point-cloud audits.
    if name not in ('loincloth_F','loincloth_B'):
        dist,nearest=cKDTree(B['P']).query(m['P']);idx=int(np.argmin(dist))
        if .0028 < dist[idx] < .012:
            q=B['P'][nearest[idx]];m['P'][idx]=q+unit(m['P'][idx]-q)*.002
    W,bones=T.transfer_weights(m['P'],B,allow=T.ARMOUR_ALLOW.get(name)) if weights is None else weights
    # The shared transfer fallback is root; replace only failed restricted transfers with the nearest permitted joint.
    allowed=T.ARMOUR_ALLOW.get(name)
    if allowed:
        bad=~np.isin(bones,allowed);failed=W[:,bad].sum(1)>.001
        if failed.any():
            W[failed]=0;W[failed,bones.index(allowed[0])]=1
    m=orient(m)
    # Weld coincident geometry before normal averaging; UVs remain per corner.
    unique,inv=np.unique(np.round(m['P'],8),axis=0,return_inverse=True)
    Wnew=np.zeros((len(unique),W.shape[1]));cnt=np.zeros(len(unique))
    np.add.at(Wnew,inv,W);np.add.at(cnt,inv,1);W=Wnew/cnt[:,None]
    m['P']=unique;m['F']=inv[m['F']]
    N=T.normals_smooth(m['P'],m['F'])
    return T.save_part(str(out),name,P=m['P'],F=m['F'],UV=m['UV'],N=N,W=W,bones=bones,tile='gear',
        meta={'role':'armour','mesh':'body','notes':notes,'body_sha':B['ckpt'].get('body_sha'),'config_seed':CONFIG['seed']})


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--frozen',action='store_true');ap.add_argument('--out',default=str(Path(T.PARTS_DIR)/'armour'))
    ap.add_argument('--preview',nargs='?',const='all');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true')
    a=ap.parse_args();B=T.load_body(frozen=a.frozen)
    if not B['ckpt'] or B['ckpt']['ckpt']<1:raise RuntimeError('B1 is required before building armour')
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True);build(B,T.Rig(),out)


# Part builders follow; each produces a deterministic function of body.npz.

def skin_patch(B,field,uv_func,offset=.002):
    P=B['P'];F=B['F'];VN=np.zeros_like(P)
    for k in range(3):np.add.at(VN,F[:,k],B['N'][:,k])
    VN=unit(VN);val=np.asarray(field(P));val=val[:,None] if val.ndim==1 else val
    pp=[];ff=[];uv=[]
    for f in F:
        if np.any(val[f].max(0)<0):continue
        poly=[(P[i],VN[i],val[i]) for i in f]
        for component in range(val.shape[1]):
            out=[]
            for i,a in enumerate(poly):
                b=poly[(i+1)%len(poly)];da=a[2][component];db=b[2][component]
                if da>=0:out.append(a)
                if (da>=0)!=(db>=0):
                    t=da/(da-db);out.append((a[0]+t*(b[0]-a[0]),unit(a[1]+t*(b[1]-a[1])),a[2]+t*(b[2]-a[2])))
            poly=out
            if len(poly)<3:break
        if len(poly)<3:continue
        base=len(pp);xyz=np.array([a[0]+offset*a[1] for a in poly]);uu=uv_func(xyz)
        if np.ptp(uu[:,0])>.7:uu[:,0]=np.where(uu[:,0]<.5,uu[:,0]+1,uu[:,0]);uu[:,0]=np.clip(uu[:,0],0,1)
        pp.extend(xyz);uv.extend(uu)
        for j in range(1,len(poly)-1):ff.append([base,base+j,base+j+1])
    return mesh(pp,ff,uv)


def theta_of(p):return np.arctan2(p[:,0],-p[:,1])


def build_top(B,S):
    cfg=CONFIG['top'];theta=np.linspace(-1.66,1.66,cfg['angles']+1)
    a=np.abs(theta)
    top=np.interp(a,[0,.65,1.15,1.66],[cfg['middle'],cfg['peak'],1.334,cfg['side']])
    bot=cfg['bottom']+.023*(np.sin(theta)**2)
    t=np.linspace(0,1,cfg['rows']+1)[:,None];z=bot[None]*(1-t)+top[None]*t
    th=np.broadcast_to(theta,z.shape);P,D=torso_ring(S,th,z)
    uv=np.stack([(th+np.pi)/(2*np.pi),(z-1.18)/.28],-1)
    def field(p):
        th=theta_of(p);a=np.abs(th);lo=cfg['bottom']+.023*np.sin(th)**2
        hi=np.interp(a,[0,.65,1.15,1.66],[cfg['middle'],cfg['peak'],1.334,cfg['side']])
        return np.stack([p[:,2]-lo,hi-p[:,2],(1.66-a)*.1,.24-np.abs(p[:,0])],axis=1)
    cup=skin_patch(B,field,lambda p:patch_uv(np.stack([(theta_of(p)+np.pi)/(2*np.pi),(p[:,2]-1.18)/.28],-1),'scale'))
    # Fitted opaque leather border, halter and backstrap are continuous shell strips.
    strips=[]
    for zz in [bot,top]:
        Z=zz[None]+np.array([-.003,.003])[:,None]
        p,d=torso_ring(S,np.broadcast_to(theta,Z.shape),Z,.0032)
        u,v=np.meshgrid(np.linspace(0,1,len(theta)),[.1,.9]);strips.append(grid(p,patch_uv(np.stack([u,v],-1),'leather'),d))
    theta2=np.linspace(1.64,2*np.pi-1.64,48)
    z2=np.broadcast_to(np.array([1.221,1.244])[:,None],(2,len(theta2)))
    p,d=torso_ring(S,np.broadcast_to(theta2,z2.shape),z2)
    u,v=np.meshgrid(np.linspace(0,1,len(theta2)),[.1,.9]);strips.append(grid(p,patch_uv(np.stack([u,v],-1),'leather'),d))
    # 2 small geometric rows provide a scalloped free edge; most scale relief stays in the normal map.
    scales=[]
    for row in range(2):
        for th0 in np.linspace(-1.5,1.5,19)+row*.035:
            zz=cfg['bottom']+.023*np.sin(th0)**2+.012+row*.018
            ths=np.array([th0-.07,th0+.07,th0+.065,th0,th0-.065,th0])
            zs=zz+np.array([.008,.008,-.003,-.012,-.003,0])
            pp,dd=torso_ring(S,ths,zs,.0032);pp[-1]+=dd[-1]*.001
            ff=[[i,(i+1)%5,5] for i in range(5)]
            uu=patch_uv([[.1,.9],[.9,.9],[.85,.4],[.5,.1],[.15,.4],[.5,.55]],'bronze')
            mm=mesh(pp,ff,uu)
            if np.cross(pp[1]-pp[0],pp[5]-pp[0])@dd[0]<0:mm['F']=mm['F'][:,::-1];mm['UV']=mm['UV'][:,::-1]
            scales.append(mm)
    return join(cup,*scales),join(*strips)


def build_brief(B,S):
    cfg=CONFIG['brief'];theta=np.linspace(-np.pi,np.pi,cfg['angles']+1)
    # Back coverage extends under the glute curve; side leg openings remain high.
    bot=cfg['crotch']+.14*np.abs(np.sin(theta))**1.4
    bot=np.where(np.cos(theta)<0,cfg['crotch']+.14*np.abs(np.sin(theta))**3.5,bot)
    t=np.linspace(0,1,cfg['rows']+1)[:,None]
    z=bot[None]*(1-t)+cfg['belt']*t
    th=np.broadcast_to(theta,z.shape);p,d=torso_ring(S,th,z)
    uv=np.stack([(th+np.pi)/(2*np.pi),(z-.785)/.30],-1)
    def field(p):
        th=theta_of(p);low=cfg['crotch']+.14*np.abs(np.sin(th))**1.4
        low=np.where(np.cos(th)<0,cfg['crotch']+.14*np.abs(np.sin(th))**3.5,low)
        return np.stack([p[:,2]-low,cfg['belt']-p[:,2],.25-np.abs(p[:,0])],axis=1)
    brief=skin_patch(B,field,lambda p:patch_uv(np.stack([(theta_of(p)+np.pi)/(2*np.pi),(p[:,2]-.785)/.30],-1),'scale'))
    # Leg-opening leather piping intersects the armoured surface, eliminating a loose rim.
    border=[]
    for delta in [-.002,.003]:
        pp,_=torso_ring(S,theta,bot+delta,.003);border.append(pp)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),[0,1]),-1)
    brief=join(brief,grid(border,patch_uv(uv,'leather'),d[:2]))
    zz=cfg['belt']-.017+np.array([0,.032])[:,None]+.013*np.abs(np.sin(theta))[None]
    pp,dd=torso_ring(S,np.broadcast_to(theta,zz.shape),zz,.0025)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),[0,1]),-1)
    belt=grid(pp,patch_uv(uv,'leather'),dd)
    edges=[tube(pp[k],.0018,'gold',sides=4,cap=False) for k in [0,1]]
    belt=join(belt,*edges)
    pieces=[]
    for theta0 in [-.76,-.38,.38,.76,2.55,-2.55]:
        zz=cfg['belt']-.001+.013*abs(np.sin(theta0))
        point,n=torso_ring(S,np.array([theta0]),np.array([zz]),.0035)
        pieces.extend([disk(point[0],.0125,n[0],'gold',10,.002),disk(point[0]+n[0]*.0015,.0095,n[0],'teal',10,.003)])
    point,n=torso_ring(S,np.array([0.]),np.array([cfg['belt']-.007]),.003)
    pieces.append(disk(point[0],.021,n[0],'gold',24,.004))
    return brief,belt,join(*pieces)


def build_loincloth(B,S,back=False):
    c=CONFIG['cloth'];nu,nv=c['cols']+1,c['rows']+1
    u,v=np.meshgrid(np.linspace(-1,1,nu),np.linspace(0,1,nv))
    bottom=c['back_bottom'] if back else c['front_bottom']
    # Preserve the broad belt root; taper the free front panel slightly more for the kicking thigh.
    x=u*c['width']/2*(1-(.22 if back else .34)*v)
    z=c['top']+(bottom-c['top'])*v
    if not back:
        # Lower V-notch: only the free hem rises centrally, leaving the upper panel opaque/continuous.
        notch=.095*np.maximum(0,1-np.abs(u)/.36)*np.clip((v-.58)/.42,0,1)
        z+=notch
    z[-1]-=.018*(np.arange(nu)%2)+.024*(1-np.abs(u[-1]))
    sign=1 if back else -1
    O=np.stack([x,np.zeros_like(x),z],-1);D=np.zeros_like(O);D[:,:,1]=sign
    # Free cloth follows the outer thigh envelope; at the root it touches the belt.
    sample=Surface(B,(B['P'][B['F']].mean(1)[:,2]<1.09)&(B['P'][B['F']].mean(1)[:,2]>.55))
    P=sample.cast(O,D,.006,far=True)
    P[:,:,0]=x;P[:,:,2]=z
    P[:,:,1]=sign*np.maximum(np.abs(P[:,:,1]),.105+.014*np.sin(v*np.pi))
    P[:,:,1]+=sign*(.003*np.cos(u*3*np.pi)+.006*np.sin(v*np.pi)*np.sin(u*2*np.pi))
    P[:,:,1]=gaussian_filter(P[:,:,1],.7)
    # Root still touches the belt; the lower half stands clear of the thigh envelope.
    P[:,:,1]+=sign*c['standoff']*np.sin(np.minimum(v/.72,1)*np.pi/2)**2
    # Separate front/back faces by 0.7mm and close the perimeter: two-sided without coincident triangles.
    uv=patch_uv(np.stack([(u+1)/2,1-v],-1),'cloth')
    front=grid(P,uv,D);P2=P-D*.0007;rear=grid(P2,uv,-D)
    borders=[]
    for coords in [(P[0],P2[0]),(P[-1],P2[-1]),(P[:,0],P2[:,0]),(P[:,-1],P2[:,-1])]:
        borders.append(grid(np.array(coords),patch_uv(np.stack(np.meshgrid(np.linspace(0,1,len(coords[0])),[.3,.4]),-1),'cloth')))
    result=join(front,rear,*borders)
    result=orient(result)
    bones=B['bones'];W=np.zeros((len(result['P']),len(bones)))
    t=np.clip((c['top']-result['P'][:,2])/(c['top']-bottom),0,1)
    names=[f"kilt_{'B' if back else 'F'}_{i}" for i in range(1,4)]
    # Upper half: predominantly pelvis. Spring influence only ramps on the lower half;
    # even the tip retains 38% pelvis so chain swings do not fling the entire cloth away.
    ramp=np.clip((t-.35)/.65,0,1);influence=c['back_tip_spring'] if back else c['tip_spring']
    influence=influence*(ramp*ramp*(3-2*ramp))
    W[:,bones.index('hips')]=1-influence
    chain=np.clip((t-.45)/.55,0,1)*2;lo=np.minimum(np.floor(chain).astype(int),1);mix=chain-lo
    for i in range(len(W)):
        W[i,bones.index(names[lo[i]])]=influence[i]*(1-mix[i])
        W[i,bones.index(names[lo[i]+1])]=influence[i]*mix[i]
    return result,(W,bones)


def limb_surface(B,R,side,kind):
    if kind=='arm': names=[f'upperarm_{side}',f'forearm_{side}',f'hand_{side}'];threshold=.25
    else:names=[f'thigh_{side}',f'shin_{side}',f'foot_{side}',f'toe_{side}'];threshold=.25
    w=B['W'][:,[B['bones'].index(b) for b in names]].sum(1)
    mask=w[B['F']].mean(1)>threshold
    return Surface(B,mask)


def limb_grid(S,start,end,t,theta,offset=.002):
    start,end=np.array(start),np.array(end);axis=unit(end-start)
    front=np.array([0.,-1,0]);front=unit(front-axis*(front@axis));side=np.cross(axis,front)
    th,tt=np.meshgrid(theta,t);O=start[None,None]+(end-start)[None,None]*tt[:,:,None]
    D=front[None,None]*np.cos(th)[:,:,None]+side[None,None]*np.sin(th)[:,:,None]
    P=S.cast(O,D,offset)
    return P,D


def build_bracer(B,R,side):
    S=limb_surface(B,R,side,'arm');start=R.joints[f'forearm_{side}'];end=R.joints[f'hand_{side}'];c=CONFIG['bracer']
    theta=np.linspace(-np.pi,np.pi,c['angles']+1);t=np.linspace(c['start'],c['end'],c['rows']+1)
    p,d=limb_grid(S,start,end,t,theta);uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),np.linspace(0,1,len(t))),-1)
    base=grid(p,patch_uv(uv,'leather'),d)
    # Broad bevelled front plate, tapered to the wrist with a pointed elbow crest.
    th=np.linspace(-1.13,1.13,13);tt=np.linspace(.27,.93,9)
    pp,dd=limb_grid(S,start,end,tt,th,.0035)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(th)),np.linspace(0,1,len(tt))),-1)
    plate=grid(pp,patch_uv(uv,'bronze'),dd)
    rims=[tube(pp[:,i],.0016,'gold',4) for i in [0,-1]]+[tube(pp[i],.0016,'gold',4) for i in [0,-1]]
    return join(base,plate,*rims)


def build_pauldron(B,R):
    cent=B['P'][B['F']].mean(1)
    S=Surface(B,(cent[:,0]<-.095)&(cent[:,0]>-.35)&(cent[:,2]>1.31))
    center=R.joints['upperarm_R']+np.array([-.012,0,-.015])
    theta=np.linspace(-np.pi,np.pi,33)
    end=1.83-1.17*np.maximum(np.sin(theta),0)
    ph=np.linspace(.05,1,10)[:,None]*end[None];th=np.broadcast_to(theta,ph.shape)
    D=np.stack([np.sin(th)*np.sin(ph),-np.cos(th)*np.sin(ph),np.cos(ph)],-1)
    p=S.cast(np.broadcast_to(center,D.shape),D,.0015)
    # Raised shoulder cap, attached at its inner edge; outer rim clears the deltoid silhouette.
    row=np.linspace(0,1,len(p))[:,None]
    lift=1-np.maximum(np.sin(th),0)**8*row**4
    p[:,:,2]+=.020*lift
    p[:,:,0]-=.015*np.maximum(-np.sin(th),0)*lift
    uv=np.stack(np.meshgrid(np.linspace(0,1,p.shape[1]),np.linspace(0,1,p.shape[0])),-1)
    shell=grid(p,patch_uv(uv,'bronze'),D)
    rim=tube(p[-1],.0022,'gold',6,False)
    emboss=tube(p[5],.0015,'gold',4,False)
    # Broad cap covers the shoulder top as well as the outside of the upper arm.
    return join(shell,rim,emboss)


def build_straps(B,S):
    pieces=[]
    paths=[np.array([[-.17,1.43],[-.105,1.365],[-.025,1.282],[.055,1.17],[.13,1.065]])]
    for side in [-1,1]:paths.append(np.array([[side*.13,1.335],[side*.095,1.415],[side*.047,1.47],[side*.044,1.502]]))
    for path in paths:
        t=np.linspace(0,1,120);xz=CubicSpline(np.linspace(0,1,len(path)),path)(t)
        tangent=unit(np.gradient(xz,axis=0));cross=np.stack([-tangent[:,1],tangent[:,0]],-1)*.006
        xx=xz[:,None,:]+np.array([-1,1])[None,:,None]*cross[:,None]
        O=np.stack([xx[:,:,0],np.zeros_like(xx[:,:,0])+.18,xx[:,:,1]],-1);D=np.zeros_like(O);D[:,:,1]=-1
        P=S.cast(O,D,.002,far=True)
        cup=np.clip((P[:,:,2]-1.195)/.015,0,1)*np.clip((1.365-P[:,:,2])/.015,0,1)
        P[:,:,1]-=.0025*cup
        uv=np.stack(np.meshgrid([0,1],t),-1);pieces.append(grid(P,patch_uv(uv,'leather'),D))
    theta=np.linspace(np.pi*.35,np.pi*1.65,90);z=np.broadcast_to(np.array([1.496,1.505])[:,None],(2,len(theta)))
    pp,dd=torso_ring(S,np.broadcast_to(theta,z.shape),z,.002)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(theta)),[0,1]),-1);pieces.append(grid(pp,patch_uv(uv,'leather'),dd))
    return join(*pieces)


def boot_rings(S,R,side,z,theta,offset):
    j=R.joints;ankle=j[f'foot_{side}'];knee=j[f'shin_{side}'];toe=j[f'toe_{side}']
    z=np.asarray(z);ratio=np.clip((z-ankle[2])/(knee[2]-ankle[2]),0,1)
    x=ankle[0]+ratio*(knee[0]-ankle[0]);y=ankle[1]+ratio*(knee[1]-ankle[1])
    # Below the ankle, use the centre of the foot's actual horizontal slice.
    for i,zi in enumerate(z):
        near=S.cloud[np.abs(S.cloud[:,2]-zi)<.012]
        if len(near)>4 and zi<.12:x[i]=(near[:,0].min()+near[:,0].max())*.5;y[i]=(near[:,1].min()+near[:,1].max())*.5
    th=np.broadcast_to(theta[None],(len(z),len(theta)))
    O=np.stack([np.broadcast_to(x[:,None],th.shape),np.broadcast_to(y[:,None],th.shape),np.broadcast_to(z[:,None],th.shape)],-1)
    D=np.stack([np.sin(th),-np.cos(th),np.zeros_like(th)],-1)
    return S.cast(O,D,offset,far=True),D


def build_boot(B,R,side):
    S=limb_surface(B,R,side,'leg');c=CONFIG['boot'];th=np.linspace(-np.pi,np.pi,c['angles']+1)
    z=np.unique(np.r_[.014,.025,.045,.065,.085,.11,.14,np.linspace(.17,c['top'],14)])
    p,d=boot_rings(S,R,side,z,th,.002)
    # A continuous outsole: every bottom-ring point has z=0; no raised heel block.
    from scipy.spatial import ConvexHull
    foot=S.cloud[S.cloud[:,2]<.090];hull=foot[ConvexHull(foot[:,:2]).vertices,:2]
    center=hull.mean(0);a=hull;b=np.roll(hull,-1,axis=0);edge=b-a
    outline=[]
    for theta in th:
        ray=np.array([np.sin(theta),-np.cos(theta)]);den=ray[0]*edge[:,1]-ray[1]*edge[:,0]
        delta=a-center;tval=(delta[:,0]*edge[:,1]-delta[:,1]*edge[:,0])/np.where(abs(den)<1e-9,1e-9,den)
        uval=(delta[:,0]*ray[1]-delta[:,1]*ray[0])/np.where(abs(den)<1e-9,1e-9,den)
        valid=(tval>0)&(uval>=0)&(uval<=1)
        rad=np.max(tval[valid]) if valid.any() else .06
        outline.append(center+ray*(rad+.003))
    outline=np.array(outline)
    for row in range(3):p[row,:,:2]=outline;p[row,:,2]=[0,.014,.045][row]
    p[3,:,:2]=.6*outline+.4*p[3,:,:2]
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(th)),np.linspace(0,1,len(z))),-1)
    sgn=1 if side=='L' else -1
    shaft=skin_patch(B,lambda q:np.stack([q[:,2]-.075,c['top']-q[:,2],sgn*q[:,0]-.005],axis=1),
                     lambda q:patch_uv(np.stack([np.mod(np.arctan2(q[:,0]-R.joints[f'foot_{side}'][0],-q[:,1])/(2*np.pi)+.5,1),np.clip(q[:,2]/c['top'],0,1)],-1),'leather'))
    # A convex leather foot envelope contains every toe/heel vertex; a separate sole ring is continuous on z=0.
    cloud=S.cloud[S.cloud[:,2]<.145].copy()
    cloud=np.vstack([cloud,np.c_[outline,np.zeros(len(outline))],np.c_[outline,np.zeros(len(outline))+.014]])
    # Four curved toe-cap bands soften the convex footprint without cutting into any toe.
    fore=cloud[cloud[:,1]<cloud[:,1].min()+.050];cx=(fore[:,0].min()+fore[:,0].max())*.5
    cy=fore[:,1].min()+.026;rx=np.ptp(fore[:,0])*.5+.002
    cap=[]
    for phi in np.linspace(.08,np.pi/2,4):
        for angle in np.linspace(0,2*np.pi,17):
            cap.append([cx+rx*np.sin(phi)*np.cos(angle),cy+.027*np.sin(phi)*np.sin(angle),.014+.031*np.cos(phi)])
    cloud=np.vstack([cloud,cap])
    H=ConvexHull(cloud);hf=H.simplices.copy();tri=cloud[hf]
    nn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);bad=(nn*H.equations[:,:3]).sum(1)<0;hf[bad]=hf[bad,::-1]
    VN=np.zeros_like(cloud)
    for k in range(3):np.add.at(VN,hf[:,k],H.equations[:,:3])
    cp=cloud+unit(VN)*.002;cp[:,2]=np.maximum(cp[:,2],0)
    keep=cp[hf][:,:,2].mean(1)<.140
    footuv=patch_uv(np.stack([(cp[:,0]-cp[:,0].min())/max(np.ptp(cp[:,0]),.001),np.clip(cp[:,2]/.15,0,1)],-1),'leather')
    parts=[shaft,mesh(cp,hf[keep],footuv)]
    soleuv=patch_uv(np.stack(np.meshgrid(np.linspace(0,1,len(th)),[0,1]),-1),'leather')
    sole=np.array([p[0],p[1]]);sole[:,:,0:2]+=.0015*d[:2,:,0:2]
    parts.append(grid(sole,soleuv,d[:2]))
    center=p[0,:-1].mean(0);cp=np.vstack([p[0],center]);ff=[[i+1,i,len(cp)-1] for i in range(len(th)-1)]
    parts.append(mesh(cp,ff,patch_uv(np.zeros((len(cp),2))+.5,'leather')))
    for zz in np.linspace(.135,c['top']-.055,4):
        pp,dd=boot_rings(S,R,side,np.array([zz-.006,zz+.006]),th,.0035)
        uv=np.stack(np.meshgrid(np.linspace(0,1,len(th)),[0,1]),-1);parts.append(grid(pp,patch_uv(uv,'leather'),dd))
    # Long bronze shin shield follows the leg; it never substitutes for the leather shaft.
    tz=np.linspace(.17,c['top']-.035,10);pt=np.linspace(-.60,.60,11);pp,dd=boot_rings(S,R,side,tz,pt,.004)
    taper=.32+.68*np.linspace(0,1,len(tz));cx=R.joints[f'foot_{side}'][0]
    # Fit the taper by varying angles, keeping every sample on the body surface.
    for i,zz in enumerate(tz):pp[i],dd[i]=boot_rings(S,R,side,np.array([zz]),pt*taper[i],.004)
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(pt)),np.linspace(0,1,len(tz))),-1);parts.append(grid(pp,patch_uv(uv,'bronze'),dd))
    parts.extend([tube(pp[:,k],.0016,'gold',4) for k in [0,-1]])
    return join(*parts)


def build_fur(B,R,side):
    S=limb_surface(B,R,side,'leg');c=CONFIG['boot'];th=np.linspace(-np.pi,np.pi,41)
    z=np.linspace(c['top']-.035,c['top']+.012,4);p,d=boot_rings(S,R,side,z,th,.0025)
    p[1:3]+=d[1:3]*.004
    uv=np.stack(np.meshgrid(np.linspace(0,1,len(th)),np.linspace(0,1,len(z))),-1)
    base=grid(p,patch_uv(uv,'fur'),d)
    tufts=[]
    for row in range(2):
        for i in range(24):
            theta=-np.pi+2*np.pi*(i+.5*row)/24
            pp,dd=boot_rings(S,R,side,np.array([c['top']+.01-row*.018,c['top']-.024-row*.018]),np.array([theta-.065,theta,theta+.065]),.003)
            pp[1,1,2]-=.012+(i%3)*.002;pp[1]+=dd[1]*.005
            m=grid(pp,patch_uv(np.stack(np.meshgrid([0,.5,1],[1,0]),-1),'fur'),dd)
            tufts.append(m)
    return join(base,*tufts)


def build(B,R,out):
    start=time.monotonic();cent=B['P'][B['F']].mean(1)
    torso_mask=(np.abs(cent[:,0])<.25)&(cent[:,2]>.75)&(cent[:,2]<1.52)
    S=Surface(B,torso_mask);reps=[]
    top,frame=build_top(B,S);reps.extend([save('top',top,B,out,notes='Opaque scale cups; body ray fit 2mm + two scalloped relief rows.'),save('top_frame',frame,B,out)])
    brief,belt,buckles=build_brief(B,S)
    for name,m in [('brief',brief),('belt',belt),('buckles',buckles)]:reps.append(save(name,m,B,out))
    for back in [False,True]:
        m,w=build_loincloth(B,S,back);reps.append(save('loincloth_B' if back else 'loincloth_F',m,B,out,w))
    reps.append(save('pauldron',build_pauldron(B,R),B,out,notes='Anatomical RIGHT deltoid (-X); fitted dome and continuous rim.'))
    reps.append(save('strap',build_straps(B,S),B,out))
    pt,dd=torso_ring(S,np.array([0.]),np.array([1.277]),.003)
    around,_=torso_ring(S,np.array([-.15,.15]),np.array([1.277,1.277]),.002)
    pt[0,1]=min(pt[0,1],float(around[:,1].min())-.001)
    reps.append(save('medallion',disk(pt[0],.021,dd[0],'gold',24,.004),B,out))
    for side in ['L','R']:
        for stem,fn in [('bracer',build_bracer),('boot',build_boot),('fur',build_fur)]:
            reps.append(save(stem+'_'+side,fn(B,R,side),B,out))
    make_tiles(out)
    report={'role':'armour','body_sha':B['ckpt'].get('body_sha'),'body_ckpt':B['ckpt'],'tris':sum(x['tris'] for x in reps),'parts':{x['name']:x['tris'] for x in reps},'seconds':round(time.monotonic()-start,2),'config':CONFIG}
    (Path(T.TEAM)/'armour'/'build_report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)
    if report['tris']>CONFIG['budget']:raise RuntimeError('Armour budget exceeded')


if __name__=='__main__':main()
