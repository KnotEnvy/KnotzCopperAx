"""r28 groom: warm crown support, restrained strand contrast; braid retained.

Run through tools/blender-run.mjs -- -b --factory-startup -P blender/seraphine_groom.py -- --preview
Then build_hero_seraphine_team.py --preview-role hair. Never writes public/ or alters the donor.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import seraphine_team as T

CONFIG = {
    "seed": 26,
    "out": os.path.join(T.PARTS_DIR, "hair"),
    "report": os.path.join(T.TEAM, "hair", "groom_report.json"),
    "centre": (0.0, 0.021, 1.685),
    "shell_clearance": .0032,
    "shell_crown": .008,
    "shell_azimuths": 80,
    "lock_spine": .0045,
    "lock_sections": 19,
    "lock_sides": 8,
    "braid_sections": 88,
    "braid_sides": 20,
    "braid_top": 1.642,
    "braid_bottom": 1.143,
    "braid_pitch": .070,
    "tip_bottom": 1.095,
    "hair_rgb": (128, 58, 33),
    "gold_rgb": (198, 147, 65),
    "roughness": .73,
}


def norm(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def direction(az, el):
    a, e = np.radians(az), np.radians(el)
    a, e = np.broadcast_arrays(a, e)
    return np.stack((np.sin(a)*np.cos(e), -np.cos(a)*np.cos(e), np.sin(e)), axis=-1)


def smooth_interp(t, knots, values):
    """Cubic guide interpolation with continuous first derivatives, no scipy dependency."""
    t = np.asarray(t)
    k = np.clip(np.searchsorted(knots, t, side="right")-1, 0, len(knots)-2)
    values = np.asarray(values)
    slopes = np.gradient(values, knots)
    h = np.asarray(knots)[k+1]-np.asarray(knots)[k]
    u = (t-np.asarray(knots)[k])/h
    return ((2*u**3-3*u*u+1)*values[k] + (u**3-2*u*u+u)*h*slopes[k]
            + (-2*u**3+3*u*u)*values[k+1] + (u**3-u*u)*h*slopes[k+1])


def hairline(az):
    # Smooth the swept temple contour; no angular steps above the ear.
    a=np.abs(np.asarray(az))
    base=smooth_interp(a,[0,20,40,60,85,105,140,180],[26,23,7,-10,-18,-30,-48,-57])
    return base+.65*np.sin(np.asarray(az)*.13)*np.exp(-(a/58)**4)


class Cranium:
    def __init__(self, D):
        from mathutils.bvhtree import BVHTree
        B = D.mesh["body"]
        self.c = np.array(CONFIG["centre"])
        self.tree = BVHTree.FromPolygons(B.P.tolist(), B.F[B.faces("head")].tolist(), all_triangles=True)
        # A smoothed radial field removes donor skull triangulation and the ear silhouette from the groom.
        self.az = np.linspace(-180, 180, 145)
        self.el = np.linspace(-50, 90, 71)
        ds = direction(self.az[:, None], self.el[None, :])
        self.r = np.zeros(ds.shape[:2])
        for i in range(len(self.az)):
            for j in range(len(self.el)):
                hit = self.tree.ray_cast(tuple(self.c), tuple(ds[i, j]), .3)
                self.r[i,j] = hit[3] if hit[0] is not None else .09
        for _ in range(3):
            self.r[1:-1,1:-1] = (self.r[:-2,1:-1] + self.r[2:,1:-1] + self.r[1:-1,:-2]
                                      + self.r[1:-1,2:] + 4*self.r[1:-1,1:-1])/8
        self.cranium_count = len(D.cranium_vertices())

    def radius(self, ds):
        ds = norm(ds)
        a = np.degrees(np.arctan2(ds[...,0], -ds[...,1]))
        e = np.degrees(np.arcsin(np.clip(ds[...,2], -1, 1)))
        x = (a+180)/2.5
        y = np.clip((e+50)/2, 0, 70)
        i, j = np.minimum(x.astype(int), 143), np.minimum(y.astype(int), 69)
        u, v = x-i, y-j
        return ((1-u)*(1-v)*self.r[i,j] + u*(1-v)*self.r[i+1,j]
                + (1-u)*v*self.r[i,j+1] + u*v*self.r[i+1,j+1])

    def clearance(self, ds):
        return CONFIG["shell_clearance"] + (CONFIG["shell_crown"]-CONFIG["shell_clearance"])*np.clip(ds[...,2],0,1)**2

    def surface(self, ds, lift=0):
        ds = norm(ds)
        return self.c + ds*(self.radius(ds)+self.clearance(ds)+lift)[...,None]


def grid_faces(n, m, wrap=False):
    out=[]
    for i in range(n-1):
        for j in range(m if wrap else m-1):
            a=i*m+j; b=i*m+(j+1)%m; c=(i+1)*m+(j+1)%m; d=(i+1)*m+j
            out += [(a,b,c),(a,c,d)]
    return np.array(out, np.int32)


def orient(P, F, hint):
    f = F.copy()
    nf=np.cross(P[f[:,1]]-P[f[:,0]], P[f[:,2]]-P[f[:,0]])
    bad=(nf*hint).sum(1)<0
    f[bad]=f[bad][:,[0,2,1]]
    return f


def normals(P, F):
    acc=np.zeros_like(P)
    nf=np.cross(P[F[:,1]]-P[F[:,0]],P[F[:,2]]-P[F[:,0]])
    for i in range(3):
        np.add.at(acc,F[:,i],nf)
    return norm(acc)


def hair_weights(P, D, rigid=None):
    W=np.zeros((len(P),6))
    if rigid is not None:
        W[:,rigid]=1
        return W
    z=P[:,2]
    rest=np.array([CONFIG["braid_top"]-.04]+[D.joints[f"hair_{i}"][2] for i in range(2,6)]+[1.13])
    # First 40 mm rigid to head; blend head -> hair_1 near the root, then rest-joint interpolation.
    heights=np.array([CONFIG["braid_top"]-.04, 1.575, *rest[1:5]])
    for k,zz in enumerate(z):
        if zz>=heights[0]: W[k,0]=1
        elif zz<=heights[-1]: W[k,5]=1
        else:
            i=np.searchsorted(-heights,-zz)-1
            t=(heights[i]-zz)/(heights[i]-heights[i+1])
            W[k,i]=1-t; W[k,i+1]=t
    return W


def save(name,P,F,U,D,replaces,rigid=None,notes=""):
    P=np.asarray(P).reshape(-1,3); F=np.asarray(F).reshape(-1,3); U=np.asarray(U).reshape(-1,2)
    N=normals(P,F)
    return T.save_part(CONFIG["out"],name,P=P,F=F,UV=U[F],N=N[F],W=hair_weights(P,D,rigid),bones=T.HAIR_BONES,
                       tile="groom",meta={"role":"hair","mesh":"groom","replaces":replaces,"alpha":True,"notes":notes})


def lane_uv(t, x, lane):
    t,x=np.broadcast_arrays(t,x)
    return np.stack(((lane+.12+.76*x)/8, .18+.78*t),axis=-1)


def support_uv(P):
    """Planar strand flow avoids a radial UV pinwheel at the rear crown."""
    P=np.asarray(P)
    across=np.clip(.5+P[...,0]/.20,0,1)
    along=np.clip((P[...,2]-1.565)/.24,0,1)
    return lane_uv(along,across,4)


def build_under_volume(C,D):
    n=CONFIG["shell_azimuths"]
    az=np.linspace(-180,180,n+1)[:-1]
    boundary=hairline(az)
    v=np.linspace(0,1,25)[:-1]
    el=boundary[None,:]+(90-boundary[None,:])*v[:,None]
    ds=direction(az[None,:],el)
    lower=np.clip((el-30)/30,0,1)
    P=C.surface(ds,-.0005*lower)
    # The lower edge grows from skin. It is concealed by the feather fringe.
    P[0]=C.surface(ds[0],-CONFIG["shell_clearance"]+.0015)
    # The smoothed radial skull can undershoot near the temple/nape. Fit the
    # opaque support to the actual donor surface plus the accepted 1.8mm face
    # cranium allowance; this prevents skin cutouts between swept clumps.
    for i in range(P.shape[0]):
        for j in range(P.shape[1]):
            d=ds[i,j];hit=C.tree.ray_cast(tuple(C.c),tuple(d),.3)
            if hit[0] is not None:
                margin=.0015 if i==0 else .0035
                radius=max(float(np.linalg.norm(P[i,j]-C.c)),float(hit[3])+margin)
                P[i,j]=C.c+d*radius
    P=P.reshape(-1,3)
    F=grid_faces(24,n,True)
    top=len(P);P=np.vstack((P,C.surface(direction(0,90))))
    F=np.vstack((F,[(23*n+j,23*n+(j+1)%n,top) for j in range(n)]))
    F=orient(P,F,norm(P[F].mean(1)-C.c))
    U=support_uv(P)
    return save("under_volume",P,F,U,D,["scalp_shell"],0,"Opaque matte cranium cover; invisible support between lens locks")


def lock_guides():
    """Swept clump guides: short irregular groups over continuous long gathers."""
    guides=[]
    primaries=[(-52,6,.052,70,160),(-30,20,.072,83,177),(-8,25,.080,84,178),
               (20,22,.062,76,177),(42,7,.045,59,168),(60,-8,.026,30,160)]
    # Split each broad plate into three unequal, closely overlapping swept clumps.
    for k,(a,e,w,crest,end) in enumerate(primaries):
        for j,offset in enumerate((-.30,.02,.29)):
            d=offset*w/.10*50
            guides.append(([a+d,a+20+d*.6,(-165 if a<0 else 160)+d*.3,
                            (-end if a<0 else end)+d*.12],
                           [e+abs(j-1)*1.5,crest-2*j,48-j*5,-49-j*3],w*(.48,.40,.45)[j]))
    for side in (-1,1):
        for k,(a,e,w,lift,end) in enumerate([(49,2,.040,20,-40),(73,-13,.038,1,-48),
                                          (103,-25,.032,-13,-54),(140,-44,.024,-36,-59)]):
            for j in range(2):
                guides.append(([side*(a+j*5),side*(a+25+j*4),side*(164+j*3),side*178],
                               [e+j*2,lift+j*2,(e+end)/2,end-j*2],w*(.65 if j==0 else .52)))
    # Diagonal back gathers end at the braid root, covering the formerly bare nape.
    for side in (-1,1):
        for j in range(3):
            guides.append(([side*(105+j*13),side*(135+j*6),side*171,side*179],
                           [55-j*21,33-j*16,-8-j*14,-54-j*3],.029-j*.003))
    # Extra fine forelocks cover the front-facing crown between the longer gathers.
    for j,a in enumerate(np.linspace(-68,68,12)):
        side=-1 if a<0 else 1;e=float(hairline(a))+1
        guides.append(([a,a+side*19,side*(150+j%3*5),side*177],
                       [e,82-abs(a)*.34,42-j%4*4,-46-j%3*4],.027+.005*np.sin(j*1.7)))
    return guides


def build_locks(C,D):
    pp=[];ff=[];uu=[];count=0
    for k,(az,el,width) in enumerate(lock_guides()):
        t=np.linspace(0,1,CONFIG["lock_sections"]+1)
        ds=direction(smooth_interp(t,[0,.32,.69,1],az),smooth_interp(t,[0,.32,.69,1],el))
        centre=C.surface(ds)
        tangent=norm(np.gradient(centre,axis=0))
        side=norm(np.cross(tangent,ds))
        angles=np.linspace(0,2*np.pi,CONFIG["lock_sides"],endpoint=False)
        lateral=np.cos(angles)
        width_t=width*(.78+.22*np.sin(np.pi*t))*(1-.985*t**(2.4+(k%4)*.45))
        # Construct a true lens: broad thin sides, rounded upper spine, 1 mm underside.
        raw=centre[:,None,:]+side[:,None,:]*(lateral[None,:,None]*width_t[:,None,None]/2)
        radial=norm(raw-C.c)
        raw=C.surface(radial,-.0012)
        longitudinal=.05+.95*np.sin(np.pi*t)**.65
        if k<18:
            tail=np.clip((t-.68)/.22,0,1)
            tail=tail*tail*(3-2*tail)
            longitudinal=longitudinal*(1-tail)+.08*tail
        spine=CONFIG["lock_spine"]*(.78+.22*np.sin(k*1.8))
        section=np.where(np.sin(angles)>0,np.sin(angles)**2,-.00065/CONFIG["lock_spine"])
        h=spine*section[None,:]*longitudinal[:,None]-.004*(np.exp(-t[:,None]*35)+np.exp(-(1-t[:,None])*35))
        if k<18:
            h-=.0015*tail[:,None]
        if k>=34:
            h+=.002*np.sin(np.pi*t)[:,None]
        # Broad roots stay buried where their lateral edge crosses the soft hairline.
        # Without this envelope wide forelocks make an opaque saw-tooth fringe on bare skin.
        azimuth=np.degrees(np.arctan2(radial[...,0],-radial[...,1]))
        elevation=np.degrees(np.arcsin(radial[...,2]))
        # Preserve the lifted crest, soften only the lower shelf above the ear.
        shelf=np.clip((18-elevation)/30,0,1)
        h-=np.maximum(h,0)*.72*shelf
        edge=np.clip((elevation-hairline(azimuth)+1)/6,0,1)
        edge=edge*edge*(3-2*edge)
        h-=.011*(1-edge)
        P=raw+radial*h[...,None]
        F=grid_faces(len(t),len(angles),True)
        # Close roots and tips with buried fans, preserving the outward winding.
        Pf=P.reshape(-1,3)
        for ring,flip in [(0,True),(len(t)-1,False)]:
            ci=len(Pf);Pf=np.vstack((Pf,P[ring].mean(0)))
            caps=np.array([(ci,ring*len(angles)+j,ring*len(angles)+(j+1)%len(angles)) for j in range(len(angles))])
            if flip:caps=caps[:,[0,2,1]]
            F=np.vstack((F,caps))
        # Signed volume supplies a robust outward convention for these closed lenses.
        if np.einsum('ij,ij->i',Pf[F[:,0]],np.cross(Pf[F[:,1]],Pf[F[:,2]])).sum()<0:F=F[:,[0,2,1]]
        U=lane_uv(t[:,None],np.broadcast_to((lateral[None,:]+1)/2,P.shape[:2]),k%4)
        U=np.vstack((U.reshape(-1,2),lane_uv(np.array([0,1]),.5,k%4)))
        pp.append(Pf);ff.append(F+count);uu.append(U);count+=len(Pf)
    return save("locks",np.vstack(pp),np.vstack(ff),np.vstack(uu),D,["locks"],0,"52 tapered thin swept clumps, varied lengths and diagonal nape gathers; buried roots, no padded plates")


def close_crown_seams(C,D):
    """Bring warm support just under the swept envelope, closing black slits."""
    from mathutils.bvhtree import BVHTree
    locks=T.load_part(CONFIG['out'],'locks')
    tree=BVHTree.FromPolygons(locks['P'].tolist(),locks['F'].tolist(),all_triangles=True)
    part=T.load_part(CONFIG['out'],'under_volume');P=part['P'].copy()
    for i,p in enumerate(P):
        d=norm(p-C.c);a=float(np.degrees(np.arctan2(d[0],-d[1])))
        e=float(np.degrees(np.arcsin(d[2])))
        fade=np.clip((e-float(hairline(a))-3)/7,0,1)
        if fade<=0:continue
        targets=[];centre_hit=None
        for da,de in [(0,0),(-2,0),(2,0),(0,-2),(0,2)]:
            ray=direction(a+da,np.clip(e+de,-89,90))
            hit=tree.ray_cast(tuple(C.c+ray*.25),tuple(-ray),.25)
            if hit[0] is not None:
                radius=float(np.linalg.norm(np.array(hit[0])-C.c));targets.append(radius)
                if da==0 and de==0:centre_hit=radius
        if targets:
            current=float(np.linalg.norm(p-C.c))
            envelope=max(targets)-.0012
            if centre_hit is not None:envelope=min(envelope,centre_hit-.0012)
            radius=max(current,min(current+.0035,envelope))
            P[i]=C.c+d*(current+(radius-current)*fade)
    T.save_part(CONFIG['out'],'under_volume',P=P,F=part['F'],UV=support_uv(P)[part['F']],N=normals(P,part['F'])[part['F']],
                W=part['W'],bones=part['bones'],tile='groom',meta=part['meta'])


def braid_centre(z):
    z=np.asarray(z)
    y=np.interp(-z,[-1.65,-1.54,-1.43,-1.33,-1.23,-1.09],[.122,.144,.165,.177,.178,.181])
    return np.stack((np.zeros_like(z),y,z),axis=-1)


def tube(path, radius, sides=20, caps=True):
    path=np.asarray(path);radius=np.broadcast_to(radius,len(path))
    tangent=norm(np.gradient(path,axis=0))
    a=norm(np.cross(tangent,np.array([0,1,0])))
    b=norm(np.cross(tangent,a))
    ang=np.arange(sides)*2*np.pi/sides
    P=path[:,None,:]+radius[:,None,None]*(a[:,None,:]*np.cos(ang)[None,:,None]+b[:,None,:]*np.sin(ang)[None,:,None])
    F=grid_faces(len(path),sides,True)
    P=P.reshape(-1,3)
    if caps:
        for i,flip in [(0,True),(len(path)-1,False)]:
            ci=len(P);P=np.vstack((P,path[i]))
            fs=np.array([(ci,i*sides+j,i*sides+(j+1)%sides) for j in range(sides)])
            if flip:fs=fs[:,[0,2,1]]
            F=np.vstack((F,fs))
    if np.einsum('ij,ij->i',P[F[:,0]],np.cross(P[F[:,1]],P[F[:,2]])).sum()<0:F=F[:,[0,2,1]]
    return P,F


def build_braid(C,D):
    pp=[];ff=[];uu=[];count=0
    t=np.linspace(0,1,CONFIG["braid_sections"]+1)
    z=CONFIG["braid_top"]+(CONFIG["braid_bottom"]-CONFIG["braid_top"])*t
    for i in range(3):
        phase=(CONFIG["braid_top"]-z)*2*np.pi/(2*CONFIG["braid_pitch"])+i*2*np.pi/3
        radius=.015-.007*t
        path=braid_centre(z)
        path[:,0]+=(.015-.007*t)*np.sin(phase)
        path[:,1]+=(.014-.006*t)*np.sin(2*phase)
        P,F=tube(path,radius,CONFIG["braid_sides"])
        U=lane_uv(t[:,None],np.broadcast_to(np.linspace(0,1,CONFIG["braid_sides"])[None,:],(len(t),CONFIG["braid_sides"])),i)
        U=np.vstack((U.reshape(-1,2),lane_uv(np.array([0,1]),.5,i)))
        pp.append(P);ff.append(F+count);uu.append(U);count+=len(P)
    return save("plait",np.vstack(pp),np.vstack(ff),np.vstack(uu),D,["braid"])


def build_tip(C,D):
    t=np.linspace(0,1,7)
    z=CONFIG["braid_bottom"]+.006+(CONFIG["tip_bottom"]-CONFIG["braid_bottom"]-.006)*t
    P,F=tube(braid_centre(z),.013*(1-t)**.72+.0005,20)
    U=lane_uv(np.repeat(t,20),np.tile(np.linspace(0,1,20),len(t)),2)
    U=np.vstack((U,((.31,.18),(.31,.96))))
    return save("tuft",P,F,U,D,["braid_tip"],5)


def build_metal(C,D):
    # Trace the visible groom surface, not the skull, so the circlet stays on the new locks.
    from mathutils.bvhtree import BVHTree
    ps=[T.load_part(CONFIG["out"],n) for n in ("under_volume","locks")]
    P=np.vstack([p['P'] for p in ps]);F=np.vstack((ps[0]['F'],ps[1]['F']+len(ps[0]['P'])))
    tree=BVHTree.FromPolygons(P.tolist(),F.tolist(),all_triangles=True)
    az=np.linspace(-180,180,97)
    ds=direction(az,np.interp(np.abs(az),[0,70,120,180],[30,15,-3,-13]))
    path=[]
    for d in ds:
        origin=C.c+d*.22
        hit=tree.ray_cast(tuple(origin),tuple(-d),.25)
        path.append(np.array(hit[0])+d*.0012 if hit[0] is not None else C.surface(d,.001))
    P,F=tube(path,.0030,6,False)
    metas=[save("circlet",P,F,np.tile((.9,.075),(len(P),1)),D,["metal"],0)]
    # Single round brow disc, low-domed front, 40 sides and no rays or V-shaped crest.
    d=direction(0,30);origin=C.c+d*.22;hit=tree.ray_cast(tuple(origin),tuple(-d),.25)
    c=(np.array(hit[0]) if hit[0] is not None else C.surface(d))+d*.0028
    theta=np.linspace(0,2*np.pi,41)
    path=c+np.stack((np.cos(theta)*.012,np.zeros_like(theta),np.sin(theta)*.012),axis=-1)
    # Filled flattened sphere, smooth round outline.
    pp=[c+d*.0017];fs=[]
    for rad in (.42,.77,1):
        for a in theta[:-1]:pp.append(c+np.array([math.cos(a)*.012*rad,0,math.sin(a)*.012*rad])+d*.0017*math.sqrt(1-rad*rad))
    fs += [(0,1+j,1+(j+1)%40) for j in range(40)]
    for i in range(2):
        for j in range(40):
            a=1+i*40+j;b=1+i*40+(j+1)%40;c0=b+40;dd=a+40;fs += [(a,b,c0),(a,c0,dd)]
    pp=np.array(pp);fs=orient(pp,np.array(fs),np.tile(d,(len(fs),1)))
    metas.append(save("sun_disc",pp,fs,np.tile((.9,.075),(len(pp),1)),D,[],0))
    plait=T.load_part(CONFIG["out"],"plait")["P"]
    for name,z,h,r,rigid in [("nape_cuff",1.612,.014,.028,0),("tip_cuff",1.149,.010,.016,5)]:
        band=plait[np.abs(plait[:,2]-z)<h/2+.001]
        distance=np.linalg.norm((band-braid_centre(band[:,2]))[:,:2],axis=1)
        # Clear the actual round lobes. A nominal circular radius clipped the deeper weave.
        r=max(r,float(distance.max())+.0015)
        theta=np.linspace(0,2*np.pi,49)[:-1]
        zz=z+np.array([-h/2,-h/2+.001,h/2-.001,h/2])
        rr=r+np.array([-.0005,0,0,-.0005])
        centre=braid_centre(zz)
        pp=centre[:,None,:]+np.stack((rr[:,None]*np.cos(theta)[None,:],rr[:,None]*np.sin(theta)[None,:],np.zeros((4,48))),axis=-1)
        ff=grid_faces(4,48,True)
        p=pp.reshape(-1,3)
        ff=orient(p,ff,norm(p[ff].mean(1)-braid_centre(p[ff].mean(1)[:,2])))
        metas.append(save(name,p,ff,np.tile((.9,.075),(len(p),1)),D,[],rigid))
    return metas


def build_fringe(C,D):
    pp=[];ff=[];uu=[]
    angles=np.linspace(-180,180,73)[:-1]
    for k,a in enumerate(angles):
        e=float(hairline(a));t=np.linspace(0,1,5)
        # Irregular tapered hairline follows the ear and extends into the nape.
        length=7+.5*np.sin(k*1.73) if abs(a)<65 else 5.5
        ds=direction(a+7*(1-t),e+6-length*t)
        centre=C.surface(ds,-.0006)
        side=norm(np.cross(np.gradient(centre,axis=0),ds))
        p=centre[:,None,:]+side[:,None,:]*np.array([-.0023,.0023])[None,:,None]*(1-.98*t)[:,None,None]
        f=grid_faces(5,2);p=p.reshape(-1,3);f=orient(p,f,norm(p[f].mean(1)-C.c))
        u=np.stack((np.broadcast_to(np.array([.77,.85])[None,:],(5,2)),np.broadcast_to((.25+.5*t)[:,None],(5,2))),axis=-1)
        pp.append(p);ff.append(f+k*10);uu.append(u.reshape(-1,2))
    # A few curved fine tips break the crown outline; they grow through the
    # fitted under-layer and taper to a point, rather than making broad strips.
    count=sum(len(p) for p in pp)
    for a,e in [(-100,77),(-55,83),(-20,86),(35,82),(70,76),(115,66)]:
        t=np.linspace(0,1,5);ds=direction(a+17*t,e-9*t)
        centre=C.surface(ds,-.002+.009*np.sin(t*np.pi/2)**.8)
        side=norm(np.cross(np.gradient(centre,axis=0),ds))
        p=centre[:,None,:]+side[:,None,:]*np.array([-.0012,.0012])[None,:,None]*(1-.99*t)[:,None,None]
        f=grid_faces(5,2);p=p.reshape(-1,3);f=orient(p,f,norm(p[f].mean(1)-C.c))
        u=np.stack((np.broadcast_to(np.array([.77,.85])[None,:],(5,2)),np.broadcast_to((.25+.5*t)[:,None],(5,2))),axis=-1)
        pp.append(p);ff.append(f+count);uu.append(u.reshape(-1,2));count+=len(p)
    return save("fringe",np.vstack(pp),np.vstack(ff),np.vstack(uu),D,["wisps"],0)


def make_tiles():
    # Painted broad lanes: no strand normal ridges, fine frequency grooves or bright pale crown band.
    from seraphine_hair_cards import _png
    res=2048;y,x=np.mgrid[0:res,0:res]/(res-1)
    lane=(x*8)%1
    broad=.96+.07*np.sin(lane*2*np.pi+.5)*np.sin(y*np.pi)+.035*np.cos(y*7+x*12)
    roots=1.0-.09*y
    strand=.96+.065*np.sin(lane*2*np.pi*17+.40*np.sin(y*8+lane*7))+.025*np.sin(lane*2*np.pi*39+y*3)
    clump=.95+.055*np.cos(lane*2*np.pi*3+y*2)
    col=np.array(CONFIG["hair_rgb"])[None,None,:]*broad[...,None]*roots[...,None]*strand[...,None]*clump[...,None]
    support=(x>.50)&(x<.625)
    # r28: the radial support UV fan amplified the strand sine into a rear
    # pinwheel. The support now has planar UVs, fine directional texture, and
    # the same mean auburn value as the locks rather than a bright bare stripe.
    support_tone = .97+.045*np.sin(lane*2*np.pi*17+y*.9)+.018*np.sin(lane*2*np.pi*39+y)
    col[support] = (np.array([124., 56., 32.])[None,None,:]*support_tone[...,None])[support]
    alb=np.concatenate((np.clip(col,0,255),np.full((res,res,1),255)),axis=-1)
    orm=np.zeros((res,res,3));orm[...,0]=255;orm[...,1]=255*(CONFIG["roughness"]+.07*np.sin(x*8*np.pi+y*5))
    normal=np.zeros((res,res,3));normal[:]=(128,128,255)
    normal[...,0]+=4*np.cos(lane*2*np.pi*17+.4*np.sin(y*8+lane*7))
    normal[...,1]+=1.5*np.cos(y*8+lane*7)
    normal[support,0] = (128+2*np.cos(lane*2*np.pi*17+y*.9))[support]
    normal[support,1] = 128
    # Fringe alpha occupies lane 6/7 above the gold patch; roots remain opaque.
    fringe=(x>.75)&(y>.18)
    local=np.clip((x-.77)/.08,0,1)
    alpha=(.5+.5*np.sin(x*1050+np.sin(y*13)*1.5))
    alpha=np.clip((alpha-.20)/.5,0,1)*np.clip((y-.23)/.12,0,1)
    alb[...,3]=np.where(fringe,alpha*255,255)
    gold=(x>.76)&(y>.87)
    alb[gold,:3]=CONFIG["gold_rgb"];alb[gold,3]=255
    orm[gold,1]=95;orm[gold,2]=210
    # PNG rows are top-down; geometry UVs are bottom-up.
    os.makedirs(os.path.join(CONFIG["out"],"tiles"),exist_ok=True)
    for name,arr in (("albedo",alb),("orm",orm),("normal",normal)):
        _png(os.path.join(CONFIG["out"],"tiles",f"groom_{name}.png"),arr.astype(np.uint8))


def main():
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    ap=argparse.ArgumentParser();ap.add_argument("--preview",action="store_true");ap.add_argument("--fast",action="store_true")
    ap.add_argument("--release",action="store_true");ap.add_argument("--out",default=CONFIG["out"])
    ap.add_argument("--head-only",action="store_true",help="retain r26 braid, tuft, circlet and cuffs byte-for-byte")
    args=ap.parse_args(argv);CONFIG["out"]=os.path.abspath(args.out)
    start=time.time();D=T.Donor();C=Cranium(D)
    print('[seraphine-groom] donor cranium sampled',flush=True)
    make_tiles();results=[build_under_volume(C,D),build_locks(C,D)]
    close_crown_seams(C,D)
    if not args.head_only:
        results.extend([build_braid(C,D),build_tip(C,D)])
        results.extend(build_metal(C,D))
    results.append(build_fringe(C,D))
    if args.head_only:
        results=[T.load_part(CONFIG['out'],n)['meta'] for n in T.list_parts(CONFIG['out'])]
    locks=T.load_part(CONFIG["out"],"locks")["P"]
    n=CONFIG["lock_sections"]+1;m=CONFIG["lock_sides"]
    spines=np.concatenate([locks[k*(n*m+2):k*(n*m+2)+n*m].reshape(n,m,3)[:,m//4] for k in range(len(lock_guides()))])
    ds=norm(spines-C.c);lift=(np.linalg.norm(spines-C.c,axis=1)-C.radius(ds))*1000
    crown=lift[ds[:,2]>.86]
    report={"tris":{m["name"]:m["tris"] for m in results},"total":sum(m["tris"] for m in results),"locks":len(lock_guides()),
            "width_ratio":4,"crown_lift_mm":[round(float(crown.min()),2),round(float(crown.max()),2)],
            "plait_sides":CONFIG["braid_sides"],"lobe_pitch_mm":70,
            "tip_z":CONFIG["tip_bottom"],"donor_metal_reused":False,"cranium_vertices":C.cranium_count,
            "seconds":round(time.time()-start,2),"config":CONFIG}
    T.save_json(CONFIG["report"],report);print(json.dumps(report,indent=1),flush=True)


if __name__=="__main__":main()
