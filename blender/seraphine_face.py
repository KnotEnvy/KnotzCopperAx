"""r28 face appeal: feathered pigment, living eyes/lips, slim free jaw/neck.

Run with ~/kca-assets/venv/bin/python blender/seraphine_face.py [--preview|--fast|--release].
No Blender needed here; preview assembly / QA use the team builder through blender-run.
"""
import argparse
import json
import math
import os
import sys
import time
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seraphine_team as T

CONFIG = {
    "seed": 24, "size": (640, 704), "gutter": 8,
    "chart_angle": 1.41, "chart_z": (1.557, 1.749), "chart_y": .035,
    "jaw_in_mm": 4.6, "chin_back_mm": 2.2, "nose_narrow": .13, "nose_base_fill_mm": 6.0,
    "cheek_lift_mm": 1.0, "cheek_fill_mm": 8.5, "cheek_fill_x": .057, "normal_smooth_mm": 7.0,
    "smooth_steps": 26, "smooth_factor": .32, "nose_smooth": 2.0,
    "eye_x": .032, "eye_z": 1.672, "eye_w": .029, "eye_h": .0108, "eye_tilt": 5.0,
    "mouth_z": 1.6058, "mouth_w": .047, "lip_upper": .0053, "lip_lower": .0072,
    "paint_z": 1.645, "paint_h": .012, "paint_rgb": (184, 59, 29),
    "skin_rgb": (190, 142, 113), "skin_repaint": .98,
    "lower_plane_blend": .96, "lower_plane_y": -.0775,
    "lower_plane_fade": (1.560,1.576), "chin_round_mm": 4.0, "chin_hold": .02,
    "lower_skin_lift": .08,
    "nose_bridge_mm": 5.0, "nose_tip_mm": 4.0, "nose_wing_mm": 5.0,
    "nose_columella_mm": 3.0, "upper_roll_mm": 4.0, "lower_roll_mm": 4.5,
    "final_upper_roll_mm": 2.0, "final_lower_roll_mm": 1.4, "final_mouth_crease_mm": .6,
    "paint_opacity": .78, "lash_mm": 1.7, "catchlight_mm": 1.15,
    "polish_steps": 60, "polish_factor": .32, "polish_cranium_fade_mm": 12.0,
    # r26: final silhouette constraints, metres in the donor rest frame.
    "profile_z": (1.613,1.620,1.626,1.631,1.636,1.641,1.647,1.657,1.668,1.681),
    "profile_y": (-.084,-.091,-.098,-.102,-.103,-.101,-.095,-.086,-.077,-.071),
    "nose_profile_width_mm": 10.0, "alar_front_y": -.096,
    "chin_front_y": -.099, "chin_center_z": 1.585,
    "gonion_out_mm": 4.0, "upper_neck_in_mm": 18.5, "neck_seam_fade_mm": 18.0,
    "lip_upper_extra_mm": 6.0, "lip_lower_extra_mm": 4.0,
    "profile_polish_steps": 12, "profile_polish_factor": .30, "profile_shape_hold": .03,
    "post_upper_lip_mm": 6.5, "post_lower_lip_mm": 3.5, "post_lip_crease_mm": 1.0,
    "max_move_mm": 19.8,
    "paint_crisp_rgb": (184, 59, 29), "paint_crisp_opacity": .92,
}
OUT = os.path.join(T.TEAM, "face")
PART = os.path.join(T.PARTS_DIR, "face")

def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)

def bell(P, center, radius):
    return np.exp(-.5*np.sum(((P-np.asarray(center))/np.asarray(radius))**2, axis=-1))

def normals(P, F, pid):
    q = P[F]
    fn = np.cross(q[:, 1]-q[:, 0], q[:, 2]-q[:, 0])
    acc = np.zeros((pid.max()+1, 3))
    for k in range(3):
        np.add.at(acc, pid[F[:, k]], fn)
    acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    # Area-weighted geometric normals, regularised with a small spatial Gaussian.
    # Position-neighbour filtering removes the decimator's long thin triangle bias;
    # feature creases and the unchanged body keep the raw geometric normals.
    radius=CONFIG.get("normal_smooth_mm",0)*.001
    if radius>0:
        _,first=np.unique(pid,return_index=True);points=P[first]
        distance,idx=cKDTree(points).query(points,k=32,distance_upper_bound=radius*2.5)
        good=idx<len(points);idx=np.minimum(idx,len(points)-1)
        w=np.exp(-.5*(distance/radius)**2)*good
        sm=(acc[idx]*w[...,None]).sum(1)/np.maximum(w.sum(1,keepdims=True),1e-12)
        x,y,z=points.T
        blend=(1-smooth(-.025,.015,y))*smooth(1.559,1.580,z)*(1-smooth(1.71,1.74,z))
        for c,r in [((0,-.08,1.606),(.028,.04,.012)),((-.032,-.06,1.672),(.021,.04,.011)),((.032,-.06,1.672),(.021,.04,.011))]:
            blend*=1-.85*bell(points,c,r)
        blend*=1-.55*bell(points,(0,-.095,1.646),(.017,.05,.023))
        acc=acc*(1-blend[:,None])+sm*blend[:,None]
        acc/=np.maximum(np.linalg.norm(acc,axis=1,keepdims=True),1e-12)
    return acc[pid[F]]

def build_head(D):
    B = D.mesh["body"]
    _, first, inv = np.unique(B.pos_id, return_index=True, return_inverse=True)
    P = B.P[first].copy()
    x, y, z = P.T
    front = 1-smooth(-.025, .025, y)
    lower = np.exp(-.5*((z-1.589)/.025)**2)*front
    Q = P.copy()
    Q[:, 0] -= np.sign(x)*CONFIG["jaw_in_mm"]*.001*lower*smooth(.012, .037, abs(x))
    Q[:, 1] += CONFIG["chin_back_mm"]*.001*bell(P, (0,-.064,1.576), (.021,.04,.015))
    # Continuous zygomatic lift, no hollow carved below it.
    for side in (-1, 1):
        ch = bell(P, (side*.051,-.049,1.650), (.019,.032,.013))
        Q[:, 2] += CONFIG["cheek_lift_mm"]*.001*ch
        Q[:, 1] -= .0008*ch
        Q[:, 1] -= CONFIG["cheek_fill_mm"]*.001*bell(P,(side*CONFIG["cheek_fill_x"],-.035,1.615),(.023,.040,.028))
    nose = bell(P, (0,-.078,1.641), (.020,.026,.022))
    Q[:, 0] -= x*CONFIG["nose_narrow"]*nose
    Q[:, 1] += .0012*bell(P, (0,-.074,1.633), (.020,.024,.008))
    Q[:, 1] += .0025*bell(P, (0,-.090,1.642), (.017,.021,.011))
    Q[:, 1] -= CONFIG["nose_base_fill_mm"]*.001*bell(P,(0,-.079,1.6315),(.015,.025,.007))
    # Upper and lower lip rolls, broad enough to avoid pinching donor triangles.
    for zz, amount in ((1.610, .0008), (1.602, .0012)):
        Q[:, 1] -= amount*bell(P, (0,-.078,zz), (.018,.025,.005))
    protected = np.zeros(len(P), bool)
    protected[B.pos_id[np.isin(B.pos_id, D.pinned_positions("face"))]] = True
    cr = np.unique(B.pos_id[D.cranium_vertices()])
    head = np.zeros(len(P), bool); head[B.pos_id[B.verts_of("head")]] = True
    editable = head & ~protected
    # Welded Laplacian, with smooth falloff away from nose/lip/eye creases.
    edges = np.concatenate([B.pos_id[B.F][:, [0,1]], B.pos_id[B.F][:, [1,2]], B.pos_id[B.F][:, [2,0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    mask = front*smooth(1.559,1.58,z)*(1-smooth(1.71,1.74,z))
    for c, r in [((0,-.08,1.642),(.023,.04,.019)), ((0,-.08,1.606),(.030,.04,.014))]:
        mask *= 1-.60*bell(P,c,r)
    for s in (-1,1):
        mask *= 1-.95*bell(P,(s*.032,-.06,1.672),(.020,.035,.012))
    mask *= editable
    mask=np.maximum(mask,CONFIG["nose_smooth"]*bell(P,(0,-.078,1.648),(.020,.035,.021))*editable)
    counts = np.bincount(edges.ravel(), minlength=len(P))
    for _ in range(CONFIG["smooth_steps"]):
        acc = np.zeros_like(Q)
        np.add.at(acc,edges[:,0],Q[edges[:,1]]); np.add.at(acc,edges[:,1],Q[edges[:,0]])
        avg = acc/np.maximum(counts[:,None],1)
        Q += (avg-Q)*mask[:,None]*CONFIG["smooth_factor"]
    # r25: the donor's V-section chin pointed down and sideways into the key
    # terminator. A broad upright perioral plane replaces that keel. This is a
    # position edit, not a painted light or a camera-dependent normal field.
    ax=np.abs(Q[:,0]);zz=Q[:,2]
    lower_plane=CONFIG["lower_plane_blend"]*smooth(*CONFIG["lower_plane_fade"],zz)*(1-smooth(1.625,1.654,zz))
    lower_plane*=front*(1-smooth(.039,.060,ax))*editable
    target=CONFIG["lower_plane_y"]+.025*(ax/.041)**3.4
    target-=CONFIG["chin_round_mm"]*.001*np.exp(-.5*((zz-1.588)/.019)**2)
    Q[:,1]+=(target-Q[:,1])*lower_plane
    # Nose bridge descends into a rounded tip with separate alar wings and
    # shallow nostril recesses. Features follow relaxation so it cannot erase
    # their relief. All fields are bilateral, smooth and welded.
    surface=front*editable
    Q[:,1]-=CONFIG["nose_bridge_mm"]*.001*bell(Q,(0,-.075,1.659),(.007,.05,.020))*surface
    Q[:,1]-=CONFIG["nose_tip_mm"]*.001*bell(Q,(0,-.083,1.640),(.0085,.05,.0080))*surface
    Q[:,1]-=CONFIG["nose_columella_mm"]*.001*bell(Q,(0,-.083,1.632),(.005,.05,.004))*surface
    for side in (-1,1):
        Q[:,1]-=CONFIG["nose_wing_mm"]*.001*bell(Q,(side*.011,-.077,1.635),(.005,.05,.005))*surface
        Q[:,1]+=.0015*bell(Q,(side*.0085,-.088,1.6315),(.0027,.05,.0018))*surface
    # The mouth line is a shallow crease between two continuous vermilion rolls.
    u=Q[:,0]/(CONFIG["mouth_w"]*.5);span=np.maximum(0,1-u*u)**.75
    line=CONFIG["mouth_z"]+.0005*u*u
    upper_z=line+.0028+.0010*np.exp(-((ax-.0065)/.004)**2)
    Q[:,1]-=CONFIG["upper_roll_mm"]*.001*np.exp(-.5*((zz-upper_z)/.0026)**2)*span*surface
    Q[:,1]-=CONFIG["lower_roll_mm"]*.001*np.exp(-.5*((zz-(line-.0038))/.0031)**2)*span*surface
    Q[:,1]+=.0007*np.exp(-.5*((zz-line)/.0009)**2)*span*surface
    for side in (-1,1):
        Q[:,1]+=.0009*bell(Q,(side*.022,-.078,1.606),(.003,.05,.003))*surface
    # Smooth the bottom of the chin into the upright plane, with no centre cut.
    Q[:,1]-=.0015*bell(Q,(0,-.071,1.586),(.017,.05,.010))*surface
    # Respect the Tier A movement envelope smoothly, including at cheek sides.
    delta=Q-P;length=np.linalg.norm(delta,axis=1)
    scale=np.minimum(1,.0195/np.maximum(length,1e-12))
    Q=P+delta*scale[:,None]
    # Relax triangulation bias in the newly widened cheek/chin transitions.
    # Small nose/lip/eye bands retain their actual geometric relief.
    px,py,pz=Q.T
    polish=(1-smooth(-.025,.02,py))*smooth(1.56,1.58,pz)*(1-smooth(1.71,1.74,pz))*editable
    cr_distance,_=cKDTree(Q[cr]).query(Q)
    polish*=smooth(0,CONFIG["polish_cranium_fade_mm"]*.001,cr_distance)
    for c,r in [((0,-.08,1.606),(.028,.06,.012)),((0,-.08,1.638),(.017,.06,.013)),
                ((-.032,-.06,1.672),(.021,.06,.012)),((.032,-.06,1.672),(.021,.06,.012))]:
        polish*=1-.85*bell(Q,c,r)
    sculpted=Q.copy()
    hold=CONFIG["chin_hold"]*front*editable*smooth(1.565,1.580,pz)*(1-smooth(1.597,1.616,pz))
    hold*=1-smooth(.025,.048,abs(px))
    for _ in range(CONFIG["polish_steps"]):
        acc=np.zeros_like(Q)
        np.add.at(acc,edges[:,0],Q[edges[:,1]]);np.add.at(acc,edges[:,1],Q[edges[:,0]])
        Q+=(acc/np.maximum(counts[:,None],1)-Q)*polish[:,None]*CONFIG["polish_factor"]
        Q+=(sculpted-Q)*hold[:,None]
    # Keep the final vermilion relief after fairing: smoothing the cheeks must
    # not turn the upper lip back into a painted stripe.
    lx,ly,lz=Q.T;u=lx/(CONFIG["mouth_w"]*.5)
    lip_span=np.maximum(0,1-u*u)**.8
    line=CONFIG["mouth_z"]+.0005*u*u
    top=line+.0028+.0009*np.exp(-((abs(lx)-.0065)/.004)**2)
    lip_surface=(1-smooth(-.025,.005,ly))*editable
    Q[:,1]-=CONFIG["final_upper_roll_mm"]*.001*np.exp(-.5*((lz-top)/.0019)**2)*lip_span*lip_surface
    Q[:,1]-=CONFIG["final_lower_roll_mm"]*.001*np.exp(-.5*((lz-line+.0038)/.0022)**2)*lip_span*lip_surface
    Q[:,1]+=CONFIG["final_mouth_crease_mm"]*.001*np.exp(-.5*((lz-line)/.00085)**2)*lip_span*lip_surface
    Q[~editable] = P[~editable]
    # Scalp may relax, but stays within the shared 2mm donor tolerance.
    delta=Q[cr]-P[cr];scale=np.minimum(1,.0018/np.maximum(np.linalg.norm(delta,axis=1),1e-12))
    Q[cr]=P[cr]+delta*scale[:,None]
    Q = sculpt_profile(P, Q, editable, cr, edges, counts)
    from seraphine_head_fix4 import reshape_head
    new = reshape_head(D, B, Q[inv])
    moved = np.flatnonzero(np.linalg.norm(new-B.P,axis=1)>1e-8)
    return new, moved

def sculpt_profile(P, Q, editable, cr, edges, counts):
    """Sculpt after fairing; broad explicit landmarks survive the smoothing pass.

    All aliases use one welded position. The eyes, fixed neck ring and scalp
    remain unchanged. No view-dependent lighting is encoded in the normals.
    """
    accepted=Q.copy()
    x,y,z=Q.T.copy(); ax=abs(x)
    front=(1-smooth(-.025,.005,y))*editable
    # A straight dorsum with a rounded distal tip, rather than a broad blob.
    from scipy.interpolate import PchipInterpolator
    target=PchipInterpolator(CONFIG["profile_z"],CONFIG["profile_y"])(np.clip(z,CONFIG["profile_z"][0],CONFIG["profile_z"][-1]))
    width=CONFIG["nose_profile_width_mm"]*.001*np.interp(z,CONFIG["profile_z"],[.6,.6,.7,.9,1,1,.9,.7,.65,.6])
    nose=np.exp(-.5*(ax/width)**2)*smooth(1.611,1.620,z)*(1-smooth(1.672,1.683,z))*front
    Q[:,1]+=(target-y)*nose
    for side in (-1,1):
        wing=bell(Q,(side*.012,-.086,1.6338),(.0048,.055,.0040))*front
        Q[:,1]+=(CONFIG["alar_front_y"]-Q[:,1])*wing*.88
        # Shallow, paired warm nostril recesses, separated by the columella.
        Q[:,1]+=.0011*bell(Q,(side*.0085,-.100,1.6312),(.0026,.05,.0015))*front
    # Leave a visible labiomental groove between lip and chin prominence.
    chin=np.exp(-.5*(ax/.016)**4)*np.exp(-.5*((z-CONFIG["chin_center_z"])/.0095)**2)*front
    Q[:,1]+=(CONFIG["chin_front_y"]-Q[:,1])*chin
    # Rounded gonion under/behind the ear; narrow the free upper neck below it.
    neck=np.exp(-.5*((z-1.584)/.010)**2)*smooth(.021,.040,ax)
    neck*=smooth(-.038,-.006,y)*(1-smooth(.048,.075,y))*editable
    seam_distance,_=cKDTree(P[~editable]).query(P)
    neck*=smooth(0,CONFIG["neck_seam_fade_mm"]*.001,seam_distance)
    Q[:,0]-=np.sign(x)*CONFIG["upper_neck_in_mm"]*.001*neck
    angle=np.exp(-.5*((z-1.607)/.008)**2)*np.exp(-.5*((y-.015)/.026)**2)*smooth(.030,.047,ax)*editable
    Q[:,0]+=np.sign(x)*CONFIG["gonion_out_mm"]*.001*angle
    # Cupid's bow has two peaks; the fuller lower lip has a distinct upper roll.
    u=x/(CONFIG["mouth_w"]*.5);span=np.maximum(0,1-u*u)**.75
    line=CONFIG["mouth_z"]+.0005*u*u
    top=line+.0027+.0012*np.exp(-((ax-.0065)/.0038)**2)-.0003*np.exp(-(x/.003)**2)
    Q[:,1]-=CONFIG["lip_upper_extra_mm"]*.001*np.exp(-.5*((z-top)/.0021)**2)*span*front
    Q[:,1]-=CONFIG["lip_lower_extra_mm"]*.001*np.exp(-.5*((z-line+.0038)/.0026)**2)*span*front
    # Remove triangle-direction bias from the stronger silhouette without
    # flattening it back to the r25 mask. Scalp and neck seam fade to zero.
    weight=(1-smooth(-.025,.015,y))*smooth(1.56,1.575,z)*(1-smooth(1.663,1.677,z))*editable
    pin_distance,_=cKDTree(P[~editable]).query(P)
    scalp_distance,_=cKDTree(P[cr]).query(P)
    weight*=smooth(0,.009,pin_distance)*smooth(0,.012,scalp_distance)
    sculpted=Q.copy()
    for _ in range(CONFIG["profile_polish_steps"]):
        acc=np.zeros_like(Q)
        np.add.at(acc,edges[:,0],Q[edges[:,1]]);np.add.at(acc,edges[:,1],Q[edges[:,0]])
        Q+=(acc/np.maximum(counts[:,None],1)-Q)*weight[:,None]*CONFIG["profile_polish_factor"]
        Q+=(sculpted-Q)*weight[:,None]*CONFIG["profile_shape_hold"]
    eye_keep=smooth(.014,.019,ax)*(1-smooth(.052,.061,ax))*smooth(1.659,1.664,z)*(1-smooth(1.685,1.692,z))
    Q=Q*(1-eye_keep[:,None])+accepted*eye_keep[:,None]
    # Lip relief is last: global fairing otherwise erases the small vermilion
    # rolls. Y-only smooth fields keep the welded X/Z parameterization intact.
    lx,ly,lz=Q.T.copy();u=lx/(CONFIG["mouth_w"]*.5)
    span=np.maximum(0,1-u*u)**.75
    line=CONFIG["mouth_z"]+.0005*u*u
    bow=line+.0033+.0010*np.exp(-((abs(lx)-.0065)/.004)**2)-.0004*np.exp(-(lx/.0035)**2)
    lip_front=(1-smooth(-.025,.005,ly))*editable*span
    Q[:,1]-=CONFIG["post_upper_lip_mm"]*.001*np.exp(-.5*((lz-bow)/.0023)**2)*lip_front
    Q[:,1]-=CONFIG["post_lower_lip_mm"]*.001*np.exp(-.5*((lz-line+.0038)/.0024)**2)*lip_front
    Q[:,1]+=CONFIG["post_lip_crease_mm"]*.001*np.exp(-.5*((lz-line)/.0010)**2)*lip_front
    Q[:,1]+=.0015*np.exp(-.5*((lz-line+.010)/.0026)**2)*lip_front
    delta=Q-P;length=np.linalg.norm(delta,axis=1)
    Q=P+delta*np.minimum(1,CONFIG["max_move_mm"]*.001/np.maximum(length,1e-12))[:,None]
    Q[~editable]=P[~editable]
    delta=Q[cr]-P[cr]
    Q[cr]=P[cr]+delta*np.minimum(1,.0018/np.maximum(np.linalg.norm(delta,axis=1),1e-12))[:,None]
    return Q

def chart_uv(P):
    theta = np.arctan2(P[...,0], CONFIG["chart_y"]-P[...,1])
    z0,z1 = CONFIG["chart_z"]
    w,h = CONFIG["size"]; g=CONFIG["gutter"]
    return np.stack([g/w+(theta/CONFIG["chart_angle"]*.5+.5)*(1-2*g/w),
                     g/h+(P[...,2]-z0)/(z1-z0)*(1-2*g/h)],axis=-1)

def resample_chart(B, P):
    w,h = CONFIG["size"]
    uvall = chart_uv(P[B.F])
    inside = ((uvall > np.array([7/w,7/h])) & (uvall < np.array([1-7/w,1-7/h]))).all((1,2))
    fidx = B.faces("head"); fidx = fidx[inside[fidx]]
    UV = uvall[fidx]
    # Keep the donor chart's sampled pixels, including at the exact boundary.
    donor = np.asarray(Image.open(os.path.join(T.DONOR_DIR,"seraphine_albedo.webp")).convert("RGB"))[::-1]/255.
    col=np.zeros((h,w,3)); pos=np.zeros_like(col); valid=np.zeros((h,w),bool); depth=np.full((h,w),np.inf)
    for fi,uv in zip(fidx,UV):
        q=uv*[w,h]; lo=np.maximum(np.floor(q.min(0)).astype(int),0); hi=np.minimum(np.ceil(q.max(0)).astype(int),[w-1,h-1])
        if (hi<lo).any(): continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        a,b,c=q;det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        if abs(det)<1e-10:continue
        v=((xx-a[0])*(c[1]-a[1])-(yy-a[1])*(c[0]-a[0]))/det
        t=((b[0]-a[0])*(yy-a[1])-(b[1]-a[1])*(xx-a[0]))/det
        bary=np.stack([1-v-t,v,t],-1)
        pp=bary@P[B.F[fi]]; old=bary@B.UV[fi]
        sy=np.clip(old[...,1]*donor.shape[0]-.5,0,donor.shape[0]-1).astype(int)
        sx=np.clip(old[...,0]*donor.shape[1]-.5,0,donor.shape[1]-1).astype(int)
        sl=np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        hit=(bary.min(-1)>=-1e-7)&(pp[...,1]<depth[sl])
        col[sl][hit]=donor[sy,sx][hit];pos[sl][hit]=pp[hit];depth[sl][hit]=pp[...,1][hit];valid[sl][hit]=True
    return fidx,UV,col,pos,valid

def paint_face(base, pos, valid):
    from seraphine_head_fix4 import paint_face as finish
    return finish(base, pos, valid, CONFIG)

def dihedral(P,F,pid):
    v=pid[F];q=P[F];n=np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    e={};angles=[]
    for i,tri in enumerate(v):
        for a,b in zip(tri,np.roll(tri,-1)):
            key=tuple(sorted((int(a),int(b))))
            if key in e: angles.append(math.degrees(math.acos(float(np.clip(n[i]@n[e[key]],-1,1)))))
            else:e[key]=i
    return float(np.percentile(angles,95)) if angles else 0

def boundary_normals(B, P, fidx, NC):
    """Geometric normals in the face; match existing donor corner normals at the UV boundary.

    This only joins the new chart to the unchanged nape/neck/scalp shading; it adds no facial normal-wrap field.
    """
    inside=np.zeros(len(B.F),bool);inside[fidx]=True
    a=np.unique(B.pos_id[B.F[inside]]);b=np.unique(B.pos_id[B.F[~inside]])
    boundary=np.intersect1d(a,b)
    _,first=np.unique(B.pos_id,return_index=True)
    # Reproduce the team's assembler: outside triangles touching moved vertices
    # get raw area-weighted geometric normals, untouched triangles keep donor N.
    # Torso fairing can change normals adjacent to the pinned head ring even
    # though the shared positions stay fixed. Reproduce its current edits too.
    scene=P.copy();body=T.load_edits(os.path.join(T.PARTS_DIR,"body"))
    if body is not None:scene[body["vidx"]]=body["P_new"]
    q=scene[B.F];fn=np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]);acc=np.zeros((B.pos_id.max()+1,3))
    for k in range(3):np.add.at(acc,B.pos_id[B.F[:,k]],fn)
    acc/=np.maximum(np.linalg.norm(acc,axis=1,keepdims=True),1e-12)
    raw=acc[B.pos_id[B.F]]
    moved=np.linalg.norm(scene-B.P,axis=1)>1e-8
    outer=B.NC.copy();touched=moved[B.F].any(1);outer[touched]=raw[touched]
    if body is not None and len(body["fidx"]):outer[body["fidx"]]=body["N"]
    target=np.zeros_like(acc);count=np.zeros(len(acc))
    for k in range(3):
        np.add.at(target,B.pos_id[B.F[~inside,k]],outer[~inside,k]);np.add.at(count,B.pos_id[B.F[~inside,k]],1)
    target/=np.maximum(count[:,None],1);target/=np.maximum(np.linalg.norm(target,axis=1,keepdims=True),1e-12)
    distance,nearest=cKDTree(P[first[boundary]]).query(P[B.F[fidx]].reshape(-1,3))
    seam=target[boundary[nearest]].reshape(-1,3,3)
    distance=distance.reshape(-1,3)
    weight=smooth(0,.007,distance)[...,None]
    n=NC[fidx]*weight+seam*(1-weight)
    return n/np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-12)

def lab_l(rgb):
    c=np.asarray(rgb);c=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
    yy=c@np.array([.2126,.7152,.0722])
    return 116*np.where(yy>.008856,np.cbrt(yy),7.787*yy+16/116)-16

def form_measurements(B, P):
    p=P[B.verts_of("head")]
    def span(z0,z1,ymax):
        q=p[(p[:,2]>=z0)&(p[:,2]<=z1)&(p[:,1]<ymax)]
        return float(np.ptp(q[:,0]))
    jaw=span(1.581,1.601,-.015);cheek=span(1.638,1.658,-.020)
    report={"eye_w_mm":CONFIG["eye_w"]*1000,"eye_h_mm":CONFIG["eye_h"]*1000,"tilt_deg":CONFIG["eye_tilt"],
            "eye_level_delta_mm":0.0,"eye_measure_method":"analytic painted aperture in donor-frame metres",
            "jaw_over_cheek":jaw/cheek,"jaw_mm":jaw*1000,"cheek_mm":cheek*1000,
            "width_method":"head-surface X extent: jaw z1.581..1.601/y<-.015; cheek z1.638..1.658/y<-.020",
            "mouth_w_mm":CONFIG["mouth_w"]*1000,"lip_upper_mm":CONFIG["lip_upper"]*1000,"lip_lower_mm":CONFIG["lip_lower"]*1000,
            "paint_h_mm":CONFIG["paint_h"]*1000,"paint_target_Lstar":float(lab_l(np.array(CONFIG["paint_rgb"])/255)),
            "sclera_target_Lstar":float(lab_l(np.array([247,246,239])/255)),"paint_roughness":.8}
    q=P[B.F[B.faces("head")]]
    a,b,c=q[:,0][:,[0,2]],q[:,1][:,[0,2]],q[:,2][:,[0,2]]
    det=(b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(b[:,1]-a[:,1])*(c[:,0]-a[:,0])
    det=np.where(abs(det)>1e-12,det,np.nan)
    def surface_y(x,z):
        v=((x-a[:,0])*(c[:,1]-a[:,1])-(z-a[:,1])*(c[:,0]-a[:,0]))/det
        t=((b[:,0]-a[:,0])*(z-a[:,1])-(b[:,1]-a[:,1])*(x-a[:,0]))/det
        hit=(v>=0)&(t>=0)&(v+t<=1)
        yy=(1-v-t)*q[:,0,1]+v*q[:,1,1]+t*q[:,2,1]
        return float(np.min(yy[hit]))
    tip=min(surface_y(0,z) for z in np.linspace(1.631,1.647,161))
    cheek=float(np.median([surface_y(s*x,z) for s in [-1,1] for x in [.018,.021,.024] for z in [1.653,1.657,1.661]]))
    lips=min(surface_y(x,z) for x in [-.006,0,.006] for z in np.linspace(1.598,1.612,71))
    chin=min(surface_y(x,z) for x in [-.004,0,.004] for z in np.linspace(1.578,1.593,76))
    def section(z,ylo,yhi):
        q=P[B.F];pts=[]
        for a,b in [(0,1),(1,2),(2,0)]:
            dz=q[:,b,2]-q[:,a,2]
            t=np.divide(z-q[:,a,2],dz,out=np.full(len(q),np.nan),where=abs(dz)>1e-12)
            hit=(t>=0)&(t<1);pp=q[hit,a]+t[hit,None]*(q[hit,b]-q[hit,a])
            pts.extend(pp[(pp[:,1]>=ylo)&(pp[:,1]<=yhi)])
        return float(np.ptp(np.asarray(pts)[:,0]))
    jaw_width=section(1.607,-.040,.052);neck_width=section(1.587,-.012,.060)
    report.update(nose_proj_mm=(cheek-tip)*1000,chin_proj_mm=(lips-chin)*1000,neck_over_jaw=neck_width/jaw_width,
                  gonion_width_mm=jaw_width*1000,upper_neck_width_mm=neck_width*1000,
                  profile_measure_method="Actual triangle-surface intersections in donor rest frame, facing -Y; tip scan z1.631..1.647, under-eye cheek median X+/-18/21/24mm Z1.653/1.657/1.661; chin z1.578..1.593 minus lip envelope z1.598..1.612; upper-neck z1.587 Y-.012..+.060 / gonion z1.607 Y-.040..+.052. Blender BVH independently verifies.")
    return report

def crease_mask(center):
    """Narrow crease bands; do not exclude the whole eye/nose/mouth area."""
    x,y,z=center.T;cfg=CONFIG;crease=np.zeros(len(center),bool)
    for side in (-1,1):
        dx=side*x-cfg["eye_x"];dz=z-cfg["eye_z"]-dx*math.tan(math.radians(cfg["eye_tilt"]))
        u=dx/(cfg["eye_w"]*.5);curve=np.maximum(0,1-u*u)**.68
        crease|=(abs(u)<1.1)&((abs(dz-cfg["eye_h"]*.56*curve)<.002)|(abs(dz+cfg["eye_h"]*.44*curve)<.002))
    u=x/(cfg["mouth_w"]*.5);line=cfg["mouth_z"]+.0005*u*u
    top=cfg["lip_upper"]*np.maximum(0,1-u*u)**.8;low=cfg["lip_lower"]*np.maximum(0,1-u*u)**.72
    crease|=(abs(u)<1.08)&((abs(z-line)<.0018)|(abs(z-line-top)<.0015)|(abs(z-line+low)<.0015))
    crease|=(abs(x)>.003)&(abs(x)<.019)&(abs(z-1.633)<.0035)
    return crease

def build():
    start=time.monotonic();os.makedirs(OUT,exist_ok=True);os.makedirs(os.path.join(PART,"tiles"),exist_ok=True)
    D=T.Donor();B=D.mesh["body"];P,moved=build_head(D)
    fidx,UV,base,pos,valid=resample_chart(B,P)
    Image.fromarray(np.uint8(np.clip(base[::-1]*255,0,255))).save(os.path.join(OUT,"donor_resampled.png"))
    painted,report=paint_face(base,pos,valid)
    # Nearest valid pixel dilation across every empty texel prevents mip rims.
    _,inds=distance_transform_edt(~valid,return_indices=True)
    painted[~valid]=painted[tuple(inds[:,~valid])]
    for kind,a in {"albedo":painted,"orm":np.zeros_like(painted)+[1,.80,0],"normal":np.zeros_like(painted)+[.5,.5,1]}.items():
        Image.fromarray(np.uint8(np.clip(a[::-1]*255+.5,0,255))).save(os.path.join(PART,"tiles",f"face_{kind}.png"))
    NC=normals(P,B.F,B.pos_id)
    T.save_edits(PART,vidx=moved,P_new=P[moved],fidx=fidx,UV=UV,N=boundary_normals(B,P,fidx,NC),tile="face",
                 meta={"role":"face","round":28,"method":"r26 central profile retained; X-only free side-jaw/neck taper; translucent cheek swipes, warm-white sclera/catchlights, fine brow hairs, lit lip rolls; r27 continuous seam and nostrils retained"})
    T.save_part(PART,"eyes",P=np.zeros((0,3)),F=np.zeros((0,3),int),UV=np.zeros((0,3,2)),N=np.zeros((0,3,3)),
                W=np.zeros((0,1)),bones=["head"],tile="face",meta={"role":"face","mesh":"body","replaces":["eyes"],"notes":"Remove the two inverted floating hidden donor spheres; eyes painted on closed head surface."})
    q=P[B.F[fidx]];area=np.linalg.norm(np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]),axis=1).sum()*.5
    uvpx=UV*np.array(CONFIG["size"]);a=uvpx[:,1]-uvpx[:,0];b=uvpx[:,2]-uvpx[:,0]
    density=float(np.sqrt(np.abs(a[:,0]*b[:,1]-a[:,1]*b[:,0]).sum()*.5/area))
    center=q.mean(1);crease=crease_mask(center)
    visible=(abs(center[:,0])<.064)&(center[:,1]<-.035)&(center[:,2]<1.717)
    report.update({"config":CONFIG,"head_tris":len(B.faces("head")),"eyes_tris":0,"face_chart_tris":len(fidx),"chart_fill":float(valid.mean()),"density_px_m":density,"density_x_body":density/700,"dihedral_p95_deg":dihedral(P,B.F[fidx[~crease]],B.pos_id),"max_move_mm":float(np.linalg.norm(P-B.P,axis=1).max()*1000),"cranium_max_mm":float(np.linalg.norm((P-B.P)[D.cranium_vertices()],axis=1).max()*1000),"seconds":time.monotonic()-start})
    report["chart_dihedral_p95_deg"]=report["dihedral_p95_deg"]
    report["dihedral_p95_deg"]=dihedral(P,B.F[fidx[visible&~crease]],B.pos_id)
    report["dihedral_scope"]="visible front face, abs(X)<64mm, Y<-35mm,Z<1.717; narrow 1.5-2mm lid/lip crease bands and 7mm nostril band excluded; ears/scalp separately in chart_dihedral"
    report["dihedral_face_tri_count"]=int((visible&~crease).sum())
    report["dihedral_excluded_crease_tris"]=int((visible&crease).sum())
    report["measures"]=form_measurements(B,P)
    body_edits_path=os.path.join(T.PARTS_DIR,"body","edits.npz")
    report["seam_body_edits_sha256"]=T.sha256(body_edits_path) if os.path.exists(body_edits_path) else None
    report["legacy_boundary_repaint_max_delta_Lstar"]=float(np.abs(lab_l(base)-lab_l(painted))[valid&(distance_transform_edt(valid)<=1.5)].max())
    T.save_json(os.path.join(OUT,"measurements.json"),report)
    print(json.dumps(report,indent=2));T.check_part(PART)

if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--preview",action="store_true");parser.add_argument("--fast",action="store_true");parser.add_argument("--release",action="store_true");parser.parse_args();build()
