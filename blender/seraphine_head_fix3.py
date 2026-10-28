"""r27 opt-in head finish. No position, UV, weight or rig changes.

Compositor: call apply_skin(P,A,O,N,frame='retarget') on donor body samples
AFTER scale_colour (including its early return). Authored face tiles already use
the identical field in donor space. Call smooth_head_normals(groups,D) once at
the beginning of pack_sheets, before hashing/copying groups into final objects.
"""
from functools import lru_cache
import numpy as np

CONFIG = {
    'skin_rgb': (191., 139., 105.),
    'upper_skin_rgb': (155., 94., 66.),
    'neck_fade_bottom': (1.505, 1.535),
    'neck_fade_top': (1.617, 1.640),
    'normal_radius': .009,
    'nose_radius': .019,
    'nose_blend': 1.0,
    'nose_underside_fairing': .75,
}


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


@lru_cache(maxsize=1)
def head_map():
    import seraphine_team as T
    D=T.Donor();maps=T.retarget_maps(D,T.load_retarget())
    return maps['head'],T.ground_offset(D,maps)


def donor_points(P,frame):
    if frame=='donor':return np.asarray(P)
    if frame!='retarget':raise ValueError(frame)
    m,dz=head_map()
    return (np.asarray(P)-[0,0,dz]-m['new'])@np.linalg.inv(m['A']).T+m['old']


def skin_field(P):
    x,y,z=np.asarray(P).T
    tone=1+.012*np.cos(x*43)+.006*np.sin(z*176)
    t=smooth(1.530,1.601,z)[:,None]
    skin=np.asarray(CONFIG['skin_rgb'])*(1-t)+np.asarray(CONFIG['upper_skin_rgb'])*t
    return tone[:,None]*skin/255.


def apply_skin(P,A,O,N,*,frame='retarget'):
    """In-place neck/jaw blend; Nx3 positions + Nx3/4 maps, returns mask.

    Coordinates are Blender Z-up. Does not classify by inherited baked colour:
    that would preserve the very dark donor patches this pass removes.
    """
    p=donor_points(P,frame);x,y,z=p.T
    a=smooth(*CONFIG['neck_fade_bottom'],z)*(1-smooth(*CONFIG['neck_fade_top'],z))
    a*=1-smooth(.067,.086,np.abs(x))
    a*=1-smooth(.109,.128,y)
    # Keep the central lip/chin texture while continuing the side-jaw field.
    central=(1-smooth(.026,.043,abs(x)))*smooth(1.583,1.599,z)
    a*=1-central
    col=skin_field(p)
    A[:,:3]=A[:,:3]*(1-a[:,None])+col*a[:,None]
    O[:,:3]=O[:,:3]*(1-a[:,None])+np.array([1,.8,0])*a[:,None]
    N[:,:3]=N[:,:3]*(1-a[:,None])+np.array([.5,.5,1])*a[:,None]
    return a


def _neighbours(P,k):
    try:
        from scipy.spatial import cKDTree
        return cKDTree(P).query(P,k=min(k,len(P)))
    except ImportError:
        from mathutils.kdtree import KDTree
        tree=KDTree(len(P))
        for i,p in enumerate(P):tree.insert(p,i)
        tree.balance();q=[tree.find_n(p,min(k,len(P))) for p in P]
        return np.array([[a[2] for a in r] for r in q]),np.array([[a[1] for a in r] for r in q])


def smooth_head_normals(groups,D,*,frame='retarget'):
    """Weld coincident body positions for one continuous anatomical normal field.

    Only head/neck corners receive changes. Area normals use the current full
    integrated surface, so torso edits cannot leave a stale target at the ring.
    """
    body=[g for key,g in groups.items() if key[0]=='body']
    P=np.concatenate([g['P'] for g in body]);F=[];off=0
    for g in body:F.append(g['F']+off);off+=len(g['P'])
    F=np.concatenate(F)
    _,first,pid=np.unique(np.round(P,7),axis=0,return_index=True,return_inverse=True)
    pos=P[first];p=donor_points(pos,frame);x,y,z=p.T
    q=P[F];fn=np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]);acc=np.zeros_like(pos)
    for k in range(3):np.add.at(acc,pid[F[:,k]],fn)
    acc/=np.maximum(np.linalg.norm(acc,axis=1,keepdims=True),1e-12)
    region=(z>1.49)&(z<1.71)&(abs(x)<.095)
    ids=np.flatnonzero(region);dist,near=_neighbours(pos[ids],96)
    def filtered(radius):
        w=np.exp(-.5*(dist/radius)**2)
        a=(acc[ids[near]]*w[...,None]).sum(1)/np.maximum(w.sum(1)[:,None],1e-12)
        return a/np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-12)
    neck=smooth(1.51,1.535,z[ids])*(1-smooth(1.603,1.627,z[ids]))
    neck*=1-smooth(.069,.086,abs(x[ids]))
    nose=(1-smooth(.014,.030,abs(x[ids])))*smooth(1.612,1.620,z[ids])*(1-smooth(1.640,1.647,z[ids]))
    nose*=1-smooth(-.065,-.033,y[ids])
    field=acc.copy();neckN=filtered(CONFIG['normal_radius']);noseN=filtered(CONFIG['nose_radius'])
    # The decimated overhang has one broad downward-facing fan where the two
    # alar recesses should be. Regularise that underside in object space; keep
    # the actual bridge/tip silhouette and the paired painted nostril detail.
    noseN[:,0]*=.55
    noseN[:,1]=np.minimum(noseN[:,1],-.72)
    noseN[:,2]=np.maximum(noseN[:,2],-.10)
    # A broad decimated fan extends below the tiny nostril recesses. Fair its
    # shading toward the continuous front plane while retaining a soft shadow.
    plane=np.stack([x[ids]*5.,-np.ones(len(ids)),np.full(len(ids),.05)],1)
    plane/=np.linalg.norm(plane,axis=1,keepdims=True)
    noseN=noseN*(1-CONFIG['nose_underside_fairing'])+plane*CONFIG['nose_underside_fairing']
    noseN/=np.maximum(np.linalg.norm(noseN,axis=1,keepdims=True),1e-12)
    field[ids]=neckN*(neck[:,None])+acc[ids]*(1-neck[:,None])
    field[ids]=field[ids]*(1-nose[:,None]*CONFIG['nose_blend'])+noseN*nose[:,None]*CONFIG['nose_blend']
    strength=np.zeros(len(pos));strength[ids]=np.maximum(neck,nose*CONFIG['nose_blend'])
    # The field above already includes the spatial transition. At full strength
    # both UV charts receive the exact same welded normal, including aliases.
    field/=np.maximum(np.linalg.norm(field,axis=1,keepdims=True),1e-12)
    cursor=0;count=0
    for g in body:
        ids=pid[cursor:cursor+len(g['P'])][g['F']];cursor+=len(g['P'])
        a=strength[ids][...,None]
        # Keep accepted r26 facial normals outside the small owned bands.
        new=g['N']*(1-a)+field[ids]*a
        g['N']=new/np.maximum(np.linalg.norm(new,axis=2,keepdims=True),1e-12)
        count+=int((a[...,0]>.001).sum())
    return {'changed_corners':count,'positions_unchanged':True,'head_form':'r26 exact'}
