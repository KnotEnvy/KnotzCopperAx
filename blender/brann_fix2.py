"""r21: conforming face detail, cheek continuity, supported shoulders and scalp.

Run only through tools/blender-run.mjs. The shipped r20 GLB is the immutable
donor; raw accessor edits preserve every unowned part and the entire rig.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from brann_fix import GLB, compact, patch_images, region_vertices
import brann_team as team

CONFIG = {
    'donor_sha': 'f455df441ff7e789fe3141e9304c3409855d870475eb465995c16307ba02cd49',
    'seed': 21,
    'eye_x': .03388, 'eye_y': 1.8242, 'mouth_y': 1.7402,
    'refine_eye_half_height': .0068, 'refine_mouth_half_height': .0068,
    'upper_lip': .0035, 'lower_lip': .0048,
    'lid_upper': .0028, 'lid_lower': .0035,
    'ear_fill': .92, 'cheek_radius_x': .090, 'cheek_radius_z': .089,
    'pelt_upperarm': .24, 'pelt_upperarm_distal': .54, 'pelt_chest': .025,
    'scalp_srgb': [15, 13, 12], 'scalp_rim': .018,
    'scalp_specular': .035,
    'skin_srgb': [162, 94, 59],
    'sclera_srgb': [169, 156, 132],
    'lip_upper_srgb': [137, 66, 46], 'lip_lower_srgb': [172, 94, 67],
    'atlas_dilate_px': 10, 'fur_root_factor': .72,
}


def log(s):
    print('[brann-fix2] '+s, flush=True)


def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def gauss(x, y, cx, cy, rx, ry):
    return np.exp(-.5*(((x-cx)/rx)**2+((y-cy)/ry)**2))


def position_keys(P):
    return [tuple(x) for x in np.rint(P.astype(np.float64)*1e7).astype(np.int64)]


def face_mask(A):
    P, U = A['POSITION'], A['TEXCOORD_0']
    return (U[:, 0] > 1456/2048-.001)&(U[:, 1] < 592/2048+.001)&(P[:, 1] > 1.65)


def refine_face(A, F, report):
    """Red/green edge subdivision: no T junctions, no changed chart boundary."""
    P = A['POSITION']
    C = P[F].mean(1)
    face = np.all(face_mask(A)[F], 1)
    sel = face&(((abs(C[:, 0]) < .037)&(abs(C[:, 1]-CONFIG['mouth_y']) < CONFIG['refine_mouth_half_height'])) |
                ((abs(abs(C[:, 0])-CONFIG['eye_x']) < .0185)&(abs(C[:, 1]-CONFIG['eye_y']) < CONFIG['refine_eye_half_height'])))
    keys = position_keys(P)
    edge_key = lambda a, b: tuple(sorted((keys[a], keys[b])))
    marked = set()
    for a, b, c in F[sel]:
        marked.update([edge_key(a,b), edge_key(b,c), edge_key(c,a)])
    data = {k: list(v) for k,v in A.items()}
    mids = {}
    def midpoint(a, b):
        key = tuple(sorted((int(a), int(b))))
        if key in mids:
            return mids[key]
        vi = len(data['POSITION'])
        mids[key] = vi
        for k in data:
            if k in ('JOINTS_0', 'WEIGHTS_0'):
                continue
            v = (A[k][a].astype(float)+A[k][b])*.5
            if k == 'NORMAL':
                v /= max(np.linalg.norm(v), 1e-12)
            data[k].append(v)
        w = {}
        for old in (a, b):
            for j, weight in zip(A['JOINTS_0'][old], A['WEIGHTS_0'][old]):
                w[int(j)] = w.get(int(j), 0)+float(weight)*.5
        vals = sorted(w.items(), key=lambda v:-v[1])[:4]
        j, w = np.zeros(4, A['JOINTS_0'].dtype), np.zeros(4)
        for i,(bone,weight) in enumerate(vals):
            j[i], w[i] = bone, weight
        data['JOINTS_0'].append(j)
        data['WEIGHTS_0'].append(w/w.sum())
        return vi
    out = []
    changed = []
    for ti,(a,b,c) in enumerate(F):
        ab,bc,ca = [midpoint(v,w) if edge_key(v,w) in marked else None for v,w in [(a,b),(b,c),(c,a)]]
        n = sum(v is not None for v in (ab,bc,ca))
        if n == 0:
            out.append([a,b,c]); continue
        assert face[ti], 'refinement reached the face chart seam'
        changed.append(ti)
        if n == 3:
            out.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
        elif n == 1:
            if ab is not None: out.extend([[a,ab,c],[ab,b,c]])
            elif bc is not None: out.extend([[b,bc,a],[bc,c,a]])
            else: out.extend([[c,ca,b],[ca,a,b]])
        else:
            if ab is None: out.extend([[c,ca,bc],[ca,a,b],[ca,b,bc]])
            elif bc is None: out.extend([[a,ab,ca],[ab,b,c],[ab,c,ca]])
            else: out.extend([[b,bc,ab],[bc,c,a],[bc,a,ab]])
    AA = {k:np.asarray(v, dtype=A[k].dtype) for k,v in data.items()}
    FF = np.asarray(out, F.dtype)
    face_tris = int(np.all(face_mask(AA)[FF], 1).sum())
    assert face_tris <= 8000
    report['face_refinement'] = dict(tier='B', donor_triangles=int(face.sum()), triangles=face_tris,
        marked_source_triangles=int(sel.sum()), split_triangles=len(changed), added_vertices=len(AA['POSITION'])-len(P),
        added_triangles=len(FF)-len(F), method='conforming red-green subdivision; unchanged face boundary')
    return AA, FF


def sculpt_face(A, report):
    P = A['POSITION'].astype(float).copy()
    old = P.copy()
    x,y,z = old.T
    ax = abs(x)
    face = face_mask(A)
    front = smooth(.005, .043, z)
    # The head seam is included where needed: every split copy of a moved
    # position receives exactly the same displacement below.
    cheek = (smooth(-.038,-.012,z)*smooth(.040,.055,ax)*(1-smooth(.080,.092,ax))
        *smooth(1.735,1.760,y)*(1-smooth(1.812,1.840,y)))
    # Inflate radially, principally OUT to the side at the ear transition.
    # Moving the pocket forward alone leaves the lateral concavity intact.
    radial=np.sqrt((x/CONFIG['cheek_radius_x'])**2+((z+.018)/CONFIG['cheek_radius_z'])**2)
    scale=1+CONFIG['ear_fill']*cheek*np.maximum(0,1-radial)/np.maximum(radial,.1)
    P[:,0]=x*scale
    P[:,2]=-.018+(z+.018)*scale
    # Ease the arch directly above the hollow so it cannot overhang a pocket.
    P[:,2] -= .0035*gauss(ax,y,.071,1.816,.012,.006)*front
    weight = face*front
    eyex = (ax-CONFIG['eye_x'])/.0155
    arch = np.maximum(0,1-eyex*eyex)**.65
    eyec = CONFIG['eye_y']+.0005*eyex
    upper = eyec+.0047*arch
    lower = eyec-.0038*arch
    taper = 1-smooth(.86,1.08,abs(eyex))
    # A continuous ocular surface with distinct lid rims above and below it.
    P[:,2] += weight*(.0020*gauss(ax,y,CONFIG['eye_x'],CONFIG['eye_y'],.011,.0040)
        +CONFIG['lid_upper']*np.exp(-.5*((y-upper-.0008)/.00165)**2)*taper
        +CONFIG['lid_lower']*np.exp(-.5*((y-lower-.0008)/.0018)**2)*taper)
    brow_y = 1.841+.009*np.sin(np.clip((ax-.011)/.051,0,1)*math.pi*.85)
    P[:,2] += weight*(.0028*np.exp(-.5*((y-brow_y)/.0062)**2)*np.exp(-.5*((ax-.034)/.024)**2))
    P[:,2] += weight*(.0022*gauss(x,y,0,1.795,.0075,.023)
        -.0013*gauss(ax,y,.0125,1.812,.004,.014)
        +.0020*gauss(ax,y,.013,1.777,.005,.004))
    # Cupid's bow follows the painted line; a fuller lower roll and the
    # labiomental depression make two readable volumes at select distance.
    mx = x/.033
    mouth_arch = np.maximum(0,1-mx*mx)**.65
    line = CONFIG['mouth_y']+.0006*(1-np.minimum(abs(mx),1))-.0011*np.minimum(abs(mx),1)**2
    lip_side = 1-smooth(.84,1.05,abs(mx))
    upper_y = line+.0029+.0010*np.exp(-((ax-.008)/.0045)**2)
    P[:,2] += weight*(CONFIG['upper_lip']*np.exp(-.5*((y-upper_y)/.0023)**2)*lip_side
        +CONFIG['lower_lip']*np.exp(-.5*((y-(line-.0035))/.0032)**2)*mouth_arch
        -.0008*np.exp(-.5*((y-line)/.0009)**2)*lip_side
        -.0013*gauss(x,y,0,CONFIG['mouth_y']-.009,.023,.0025)
        +.0028*gauss(x,y,0,1.716,.025,.008))
    # Nasolabial and cheek planes, without cutting another hollow.
    P[:,2] += weight*(.0015*gauss(ax,y,.046,1.802,.018,.009)
        +.0014*gauss(ax,y,.025,1.758,.009,.018))
    # The actual shaved upper scalp and all mane root support stay exact.
    P[y>=1.877]=old[y>=1.877]
    # Apply a single identical result on every existing positional seam copy.
    keys = position_keys(old)
    by_key = {}
    for i in np.where(np.linalg.norm(P-old,axis=1)>1e-9)[0]:
        by_key.setdefault(keys[i],P[i])
    for i,key in enumerate(keys):
        if key in by_key: P[i] = by_key[key]
    A['POSITION'] = P.astype(np.float32)
    moved = np.any(A['POSITION']!=old.astype(np.float32),axis=1)
    report['face_sculpt'] = dict(moved_vertices=int(moved.sum()),max_displacement_mm=float(np.linalg.norm(P-old,axis=1).max()*1000),
        cheek_radial_fill=CONFIG['ear_fill'],upper_lip_mm=CONFIG['upper_lip']*1000,lower_lip_mm=CONFIG['lower_lip']*1000)
    return old,moved


def shoulder_weights(g, A, groom=False):
    P = A['POSITION']; J,W = A['JOINTS_0'].copy(), A['WEIGHTS_0'].copy()
    oldJ,oldW = J.copy(),W.copy()
    bones = [g.js['nodes'][i]['name'] for i in g.js['skins'][0]['joints']]
    for sign,side in [(1,'L'),(-1,'R')]:
        x,y,z = P.T
        sx = sign*x
        if groom:
            influence = np.array([sum(float(w) for j,w in zip(jj,ww) if bones[j] in (f'clavicle_{side}',f'upperarm_{side}')) for jj,ww in zip(J,W)])
            ids = np.where((sx>.17)&(y<1.70)&(influence>.90))[0]
        else:
            influence = np.array([sum(float(w) for j,w in zip(jj,ww) if bones[j] in (f'clavicle_{side}',f'upperarm_{side}')) for jj,ww in zip(J,W)])
            ids = np.where((sx>.175)&(sx<.445)&(y>1.39)&(y<1.685)&(influence>.45))[0]
        for i in ids:
            # One anatomical field drives both pelt and the skin immediately
            # beneath it, preventing a rigid deltoid from punching through a
            # clavicle-led pelt. The lower biceps remains upperarm-dominant.
            along=(sx[i]-.235)*.766+(1.62-y[i])*.643
            cap=(smooth(1.41,1.48,y[i])*(1-smooth(.38,.445,sx[i]))
                *(1-smooth(1.65,1.69,y[i])))
            cap_upper=CONFIG['pelt_upperarm']+(CONFIG['pelt_upperarm_distal']-CONFIG['pelt_upperarm'])*smooth(0,.20,along)
            rigid_upper=.08+.92*smooth(.185,.285,sx[i])
            upper=rigid_upper*(1-cap)+cap_upper*cap
            if groom:
                chest = CONFIG['pelt_chest']+.055*(1-smooth(.18,.27,sx[i]))
                weights = {f'upperarm_{side}':upper,f'clavicle_{side}':1-upper-chest,'chest':chest}
                mix = 1.
            else:
                chest = .035*(1-smooth(.185,.245,sx[i]))
                weights = {f'upperarm_{side}':upper,f'clavicle_{side}':1-upper-chest,'chest':chest}
                mix = smooth(.175,.205,sx[i])*(1-smooth(.405,.445,sx[i]))*smooth(1.39,1.44,y[i])*(1-smooth(1.65,1.685,y[i]))
            vals = {int(j):float(w)*(1-mix) for j,w in zip(oldJ[i],oldW[i]) if w>0}
            for name,w in weights.items():
                j = bones.index(name); vals[j] = vals.get(j,0)+w*mix
            vals = sorted(vals.items(),key=lambda v:-v[1])[:4]
            J[i],W[i] = 0,0
            for k,(j,w) in enumerate(vals): J[i,k],W[i,k] = j,w
            W[i] /= W[i].sum()
    A['JOINTS_0'],A['WEIGHTS_0'] = J,W
    return int(np.any(J!=oldJ,1).sum()|0), int(np.any(abs(W-oldW)>1e-7,1).sum())


def normals_tangents(A,F,moved):
    P,U = A['POSITION'].astype(float),A['TEXCOORD_0'].astype(float)
    _,inv = np.unique(np.rint(P*1e7).astype(np.int64),axis=0,return_inverse=True)
    tri = P[F]
    cross = np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    sums = np.zeros((inv.max()+1,3))
    for k in range(3): np.add.at(sums,inv[F[:,k]],cross)
    normals = sums[inv]; normals /= np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
    active_keys = set(inv[moved].tolist())
    active = np.array([v in active_keys for v in inv])
    A['NORMAL'][active] = normals[active]
    d1,d2 = tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]
    uv = U[F]; t1,t2 = uv[:,1]-uv[:,0],uv[:,2]-uv[:,0]
    det = t1[:,0]*t2[:,1]-t1[:,1]*t2[:,0]
    r = np.where(abs(det)>1e-12,1/np.where(abs(det)>1e-12,det,1),0)
    s = (d1*t2[:,1,None]-d2*t1[:,1,None])*r[:,None]
    t = (d2*t1[:,0,None]-d1*t2[:,0,None])*r[:,None]
    ss,tt = np.zeros_like(P),np.zeros_like(P)
    for k in range(3):
        np.add.at(ss,F[:,k],s);np.add.at(tt,F[:,k],t)
    nn = A['NORMAL'].astype(float)
    tangent = ss-nn*(nn*ss).sum(1)[:,None]
    tangent /= np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-12)
    hand = np.where((np.cross(nn,tangent)*tt).sum(1)<0,-1,1)
    A['TANGENT'][active] = np.c_[tangent,hand][active]
    return active


def raster(P,U,F,size=2048,selector=None):
    """World position and coverage in the exact shipped atlas, top-down glTF UV."""
    world = np.zeros((size,size,3),np.float32);cov = np.zeros((size,size),bool)
    for tri in F if selector is None else F[selector]:
        uv = U[tri]*size
        lo = np.maximum(0,np.floor(uv.min(0)).astype(int));hi = np.minimum(size-1,np.ceil(uv.max(0)).astype(int))
        if np.any(hi<lo):continue
        xx,yy = np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        a,b,c = uv
        den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-10:continue
        wa = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        wb = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
        inside = (wa>=-1e-6)&(wb>=-1e-6)&(wa+wb<=1+1e-6)
        block = world[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        vals = wa[...,None]*P[tri[0]]+wb[...,None]*P[tri[1]]+(1-wa-wb)[...,None]*P[tri[2]]
        block[inside] = vals[inside]
        cov[lo[1]:hi[1]+1,lo[0]:hi[0]+1] |= inside
    return world,cov


def paint_face(A,F,maps,report):
    sel = np.all(face_mask(A)[F],1)
    world,cov = raster(A['POSITION'],A['TEXCOORD_0'],F,selector=sel)
    # Only work on the occupied face bounding rectangle.
    ys,xs = np.where(cov);lo=(ys.min(),xs.min());hi=(ys.max()+1,xs.max()+1)
    sl = np.s_[lo[0]:hi[0],lo[1]:hi[1]]
    world,cov = world[sl],cov[sl]
    x,y,z = world.transpose(2,0,1);ax=abs(x)
    Atex,O,N = [maps['body_'+s][sl] for s in ('albedo','orm','normal')]
    old=Atex.copy()
    dist=cov.copy();fade=np.zeros(cov.shape,float)
    for _ in range(16):
        fade += dist
        nxt=dist.copy();nxt[1:] &= dist[:-1];nxt[:-1] &= dist[1:];nxt[:,1:] &= dist[:,:-1];nxt[:,:-1] &= dist[:,1:];dist=nxt
    fade=smooth(1,12,fade)*smooth(.003,.037,z)*cov
    skin=np.zeros_like(world)+np.array(CONFIG['skin_srgb'])
    skin += gauss(ax,y,.045,1.797,.026,.028)[...,None]*np.array([6,-1,-3])
    rgb = old[...,:3].astype(float)*(1-fade[...,None])+skin*fade[...,None]
    def over(mask,col):
        nonlocal rgb
        m=np.clip(mask*fade,0,1)[...,None];rgb=rgb*(1-m)+np.asarray(col)*m
    # The painted planes reinforce real volume rather than replacing it.
    over(.55*gauss(ax,y,.047,1.806,.021,.008),skin+[15,9,5])
    over(.32*gauss(ax,y,.050,1.784,.019,.008),skin*np.array([.83,.80,.78]))
    over(.55*gauss(x,y,0,1.799,.006,.026),skin+[15,9,4])
    over(.52*gauss(ax,y,.013,1.798,.004,.021),skin*np.array([.78,.75,.72]))
    fold_x=.020+.33*(1.773-y)
    over(.25*np.exp(-.5*((ax-fold_x)/.0025)**2)*gauss(x,y,0,1.759,.05,.014),skin*.73)
    over(.28*gauss(x,y,0,1.717,.022,.008),skin+[9,5,2])
    ex=(ax-CONFIG['eye_x'])/.0155;arch=np.maximum(0,1-ex*ex)**.65
    ec=CONFIG['eye_y']+.0005*ex;up=ec+.0047*arch;down=ec-.0038*arch
    taper=1-smooth(.90,1.04,abs(ex))
    opening=smooth(down-.0004,down+.0004,y)*(1-smooth(up-.0004,up+.0004,y))*taper
    over(.21*gauss(ax,y,CONFIG['eye_x'],CONFIG['eye_y']+.008,.019,.007),skin*.58)
    over(opening,np.array(CONFIG['sclera_srgb']))
    iris_r=np.sqrt(((ax-CONFIG['eye_x'])/.0045)**2+((y-CONFIG['eye_y'])/.0048)**2)
    over(opening*(1-smooth(.91,1.04,iris_r)),[87,51,25])
    over(opening*(1-smooth(.75,.93,iris_r))*.7,[111,69,30])
    over(opening*(1-smooth(.35,.49,iris_r)),[20,14,10])
    over(opening*np.exp(-(((ax-CONFIG['eye_x']+.0012)/.00045)**2+((y-CONFIG['eye_y']-.0013)/.00045)**2))*.65,[207,188,148])
    over(np.exp(-.5*((y-up)/.00065)**2)*taper*.93,[63,33,23])
    over(np.exp(-.5*((y-down)/.0006)**2)*taper*.55,[111,61,39])
    over(np.exp(-.5*((y-down+.0018)/.0007)**2)*taper*.35,skin+[20,10,5])
    bx=np.clip((ax-.011)/.051,0,1);by=1.839+.009*np.sin(bx*math.pi*.85)
    brows=smooth(.007,.014,ax)*(1-smooth(.058,.064,ax))*np.exp(-((y-by)/(.0038*(1-.55*bx*bx)))**4)
    over(brows,[31,21,16])
    # Separate upper and lower lip zones, a shaped closed line, shadow below.
    mx=x/.033;ma=np.maximum(0,1-mx*mx)**.65
    line=CONFIG['mouth_y']+.0006*(1-np.minimum(abs(mx),1))-.0011*np.minimum(abs(mx),1)**2
    upper_h=.0040*ma+.0013*np.exp(-((ax-.008)/.0045)**2)
    lower_h=.0058*ma;side=1-smooth(.88,1.04,abs(mx))
    over(smooth(line-.0003,line+.0004,y)*(1-smooth(line+upper_h-.0004,line+upper_h+.0004,y))*side,CONFIG['lip_upper_srgb'])
    over(smooth(line-lower_h-.0004,line-lower_h+.0004,y)*(1-smooth(line-.0004,line+.0003,y))*side,CONFIG['lip_lower_srgb'])
    over(np.exp(-.5*((y-line+.0035)/.0010)**2)*side*.3,skin+[24,8,4])
    over(np.exp(-.5*((y-line)/.00065)**2)*side*.96,[78,34,24])
    over(.45*gauss(x,y,0,CONFIG['mouth_y']-.010,.023,.0020),skin*.64)
    over(.3*gauss(x,y,0,CONFIG['mouth_y']+.012,.0018,.0045),skin*.72)
    over(.22*gauss(ax,y,.0035,CONFIG['mouth_y']+.011,.0014,.004),skin+[22,12,5])
    # Exactly two healed scars, using anatomical rather than image placement.
    for (a,b) in [((.034,1.836),(.0355,1.861)),((-.062,1.803),(-.036,1.773))]:
        dx,dy=b[0]-a[0],b[1]-a[1]
        t=np.clip(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1)
        d=np.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
        width=.0014*(.8+.2*np.sin(t*math.pi))*(.9+.1*np.sin(t*49))
        scar=np.exp(-(d/width)**4)*smooth(0,.08,t)*(1-smooth(.92,1,t))
        over(scar*.94,skin+[40,37,33])
    # Preserve the existing forehead/hairline boundary until the scalp pass.
    hair=smooth(1.882,1.905,y)*(1-smooth(65,110,old[...,:3].mean(2)))
    rgb=rgb*(1-hair[...,None])+old[...,:3]*hair[...,None]
    Atex[...,:3]=np.clip(np.rint(rgb),0,255)
    blend=fade*(1-hair)
    O[...,:3]=np.rint(O[...,:3]*(1-blend[...,None])+np.array([248,202,0])*blend[...,None])
    N[...,:3]=np.rint(N[...,:3]*(1-blend[...,None])+np.array([128,128,255])*blend[...,None])
    report['face_texture']=dict(texels=int((fade>0).sum()),scars='LEFT brow (+X), RIGHT cheek (-X)',tile='same shipped 576px chart',
        eye_opening_mm=8.5,iris_diameter_mm=9,upper_and_lower_lip=True)


def scalp(g,A,F,R,maps,report):
    P,U=A['POSITION'],A['TEXCOORD_0']
    # Donor scalp plus dark painted hairline. Do not move any scalp geometry.
    sampled=maps['body_albedo'][np.clip((U[:,1]*2048).astype(int),0,2047),np.clip((U[:,0]*2048).astype(int),0,2047),:3].astype(float)
    dark=(sampled.mean(1)<100)&(sampled[:,0]<sampled[:,1]*1.45+3)
    # The donor's "scalp" UV island also includes skin behind the ear and on
    # the neck. Select the existing cool dark hair pigment, not the whole island.
    on=((R=='scalp')|face_mask(A))&(P[:,1]>1.85)&dark
    sel=np.all(on[F],1)
    _,mask=raster(P,U,F,selector=sel)
    # Dilation supplies the original chart border texels used by mipmaps.
    for _ in range(6):
        old=mask.copy();mask[1:]|=old[:-1];mask[:-1]|=old[1:];mask[:,1:]|=old[:,:-1];mask[:,:-1]|=old[:,1:]
    pigment=maps['body_albedo'][...,:3].astype(float)
    mask &= (pigment.mean(2)<110)&(pigment[...,0]<pigment[...,1]*1.5+4)
    yy,xx=np.mgrid[0:2048,0:2048]
    variation=.96+.025*np.sin(xx*.09+yy*.04)
    maps['body_albedo'][mask,:3]=np.clip(np.array(CONFIG['scalp_srgb'])*variation[mask,None],0,255)
    maps['body_orm'][mask,:3]=[250,250,0]
    maps['body_normal'][mask,:3]=[128,128,255]
    material=copy.deepcopy(g.js['materials'][1]);material['name']='M_brann_scalp_matte'
    material['extras']['kcaRimScale']=CONFIG['scalp_rim']
    material.setdefault('extensions',{})['KHR_materials_specular']={'specularFactor':CONFIG['scalp_specular']}
    g.js['materials'].append(material)
    report['scalp']=dict(triangles=int(sel.sum()),texels=int(mask.sum()),position_delta=0,rim=CONFIG['scalp_rim'],specular=CONFIG['scalp_specular'])
    return sel,len(g.js['materials'])-1


def seam_edges(P,F):
    keys=position_keys(P)
    edges={}
    for a,b,c in F:
        for v,w in [(a,b),(b,c),(c,a)]:
            key=tuple(sorted((keys[v],keys[w])));edges[key]=edges.get(key,0)+1
    return {k:v for k,v in edges.items() if v!=2}


def trim_and_padding(A,F,maps,report):
    """Texture-only trim roots and nearest occupied-chart mip padding."""
    world,cov=raster(A['POSITION'],A['TEXCOORD_0'],F)
    x,y,z=world.transpose(2,0,1)
    Atex,O,N=[maps['body_'+s] for s in ('albedo','orm','normal')]
    rgb=Atex[...,:3].astype(float)
    # The cheek-to-ear transition crosses from the face tile into the donor's
    # back-head chart. Remove the inherited cavity bake on that chart as well.
    yy,xx=np.mgrid[0:2048,0:2048]
    outside_face=~((xx>=1456)&(xx<2032)&(yy>=16)&(yy<592))
    cheek=(smooth(.045,.059,abs(x))*(1-smooth(.080,.092,abs(x)))
        *smooth(1.735,1.760,y)*(1-smooth(1.812,1.840,y))*smooth(-.040,-.012,z)*cov)
    blend=(cheek*.94)[...,None]
    color_blend=blend*outside_face[...,None]
    Atex[...,:3]=np.rint(rgb*(1-color_blend)+np.array([170,98,61])*color_blend)
    O[...,:3]=np.rint(O[...,:3]*(1-blend)+np.array([250,202,0])*blend)
    N[...,:3]=np.rint(N[...,:3]*(1-blend)+np.array([128,128,255])*blend)
    rgb=Atex[...,:3].astype(float)
    belt=(y>.94)&(y<1.055);boot=(y>.36)&(y<.49)
    neutral=(rgb.mean(2)>22)&(rgb.mean(2)<170)&(rgb[...,0]<rgb[...,1]*1.45)&(rgb.max(2)-rgb.min(2)<50)
    fur=cov&(belt|boot)&neutral
    along=np.where(belt,(1.055-y)/.115,(y-.36)/.13)
    roots=CONFIG['fur_root_factor']+(1-CONFIG['fur_root_factor'])*smooth(.12,.75,along)
    breakup=.94+.075*np.sin(x*233+z*137+np.sin(y*67))+.035*np.sin(x*571-z*431)
    Atex[fur,:3]=np.clip(rgb[fur]*(roots*breakup)[fur,None],0,255)
    O[fur,1]=242;O[fur,2]=0
    N[fur,:2]=np.rint(128+(N[fur,:2].astype(float)-128)*.45);N[fur,2]=255
    # Preserve every occupied texel. Only the unused border is filled from
    # already occupied neighbours; no UVs/charts are moved or resized.
    valid=cov.copy();count=0
    for _ in range(CONFIG['atlas_dilate_px']):
        pending=np.zeros_like(valid)
        for axis,shift in [(0,1),(0,-1),(1,1),(1,-1)]:
            neighbour=np.roll(valid,shift,axis)
            if axis==0:neighbour[0 if shift==1 else -1]=False
            else:neighbour[:,0 if shift==1 else -1]=False
            add=neighbour&~valid&~pending
            for im in (Atex,O,N):
                im[add]=np.roll(im,shift,axis)[add]
            pending|=add
        count+=int(pending.sum());valid|=pending
    report['extras']=dict(furtrim_texels=int(fur.sum()),darker_roots=CONFIG['fur_root_factor'],
        padding_px=CONFIG['atlas_dilate_px'],dilated_unused_texels=count,occupied_uv_texels_preserved=True,
        lateral_cheek_bake_neutralized_texels=int((cheek>.01).sum()))


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--base-glb',default=os.path.join(ROOT,'progress/tmp/brann_fix2/baseline/hero_brann.glb'))
    ap.add_argument('--base-textures',default=os.path.join(ROOT,'progress/tmp/brann_fix2/baseline'))
    ap.add_argument('--out',required=True)
    modes=ap.add_mutually_exclusive_group();modes.add_argument('--preview',action='store_true');modes.add_argument('--fast',action='store_true');modes.add_argument('--release',action='store_true')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    t=time.time();out=os.path.abspath(args.out);os.makedirs(out,exist_ok=True)
    assert not out.startswith(os.path.join(ROOT,'public'))
    assert hashlib.sha256(open(args.base_glb,'rb').read()).hexdigest()==CONFIG['donor_sha']
    g=GLB(args.base_glb);orig=copy.deepcopy(g.js)
    maps={im['name']:np.fromfile(os.path.join(args.base_textures,im['name']+'.rgba'),np.uint8).reshape(2048,2048,4).copy() for im in g.js['images']}
    report=dict(config=CONFIG,mode='release' if args.release else 'fast' if args.fast else 'preview')
    pr=g.js['meshes'][1]['primitives'][0]
    originalA={k:g.acc(v) for k,v in pr['attributes'].items()};originalF=g.acc(pr['indices']).reshape(-1,3)
    A,F=refine_face(originalA,originalF,report)
    oldP,moved=sculpt_face(A,report)
    report['shoulder_body_weights']=shoulder_weights(g,A)
    original_n=len(originalA['POSITION'])
    moved[original_n:]=True
    allF=np.concatenate([F]+[g.acc(p['indices']).reshape(-1,3) for p in g.js['meshes'][1]['primitives'][1:]])
    moved |= normals_tangents(A,allF,moved)
    log(f'stage face geometry done in {time.time()-t:.1f}s')
    paint_face(A,F,maps,report)
    # Region labels are evaluated on the r20 donor positions, before local edits.
    R=region_vertices(originalA['POSITION'],team.Donor())
    R=np.r_[R,np.full(len(A['POSITION'])-original_n,'face')]
    scalp_sel,scalp_mat=scalp(g,A,F,R,maps,report)
    trim_and_padding(A,allF,maps,report)
    for k,v in A.items():
        new=g.array(pr['attributes'][k],v)
        for piece in g.js['meshes'][1]['primitives']:piece['attributes'][k]=new
    pr['indices']=g.array(pr['indices'],F[~scalp_sel].reshape(-1,1))
    piece=copy.deepcopy(pr);piece['indices']=g.array(pr['indices'],F[scalp_sel].reshape(-1,1));piece['material']=scalp_mat
    g.js['meshes'][1]['primitives'].append(piece)
    groom=g.js['meshes'][0]['primitives'][0]
    G={k:g.acc(v) for k,v in groom['attributes'].items()}
    report['shoulder_pelt_weights']=shoulder_weights(g,G,groom=True)
    for k in ('JOINTS_0','WEIGHTS_0'):groom['attributes'][k]=g.array(groom['attributes'][k],G[k])
    # Audit the same boundary edges in their original position-key space: every
    # newly subdivided face edge is internal; all inherited outer edges survive.
    assert seam_edges(oldP,F)==seam_edges(originalA['POSITION'],originalF),'topology seam changed'
    assert g.js['nodes']==orig['nodes'] and g.js['skins']==orig['skins']
    untouched=~moved[:original_n]
    assert np.array_equal(A['POSITION'][:original_n][untouched],originalA['POSITION'][untouched])
    assert np.array_equal(A['NORMAL'][:original_n][untouched],originalA['NORMAL'][untouched])
    # Kilt triangles, UVs, materials and weights must remain exact.
    kilt=np.unique(np.concatenate([g.acc(p['indices']).reshape(-1) for p in g.js['meshes'][1]['primitives'] if p['material'] in (2,3)]))
    for k in originalA:assert np.array_equal(A[k][kilt],originalA[k][kilt]),'changed kilt '+k
    report['audit']=dict(rig_identical=True,face_boundary_edges_unchanged=True,conforming_no_new_open_edges=True,
        untouched_vertices=int(untouched.sum()),untouched_position_normal_tangent_uv_delta=0,kilt_identical=True,
        groom_geometry_identical=True,non_face_topology_identical=True)
    log(f'stage textures and audits done in {time.time()-t:.1f}s')
    patch_images(g,maps,out);compact(g)
    path=os.path.join(out,'hero_brann.glb');g.save(path)
    report.update(triangles=sum(g.acc(p['indices']).size//3 for m in g.js['meshes'] for p in m['primitives']),
        sha256=hashlib.sha256(open(path,'rb').read()).hexdigest(),seconds=round(time.time()-t,2))
    assert report['triangles']<=75000
    json.dump(report,open(os.path.join(out,'build_report.json'),'w'),indent=2)
    log(f'DONE {path}: {report["triangles"]} tris in {report["seconds"]}s')


if __name__=='__main__':main()
