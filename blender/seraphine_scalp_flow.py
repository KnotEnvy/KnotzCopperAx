"""Continuous hairline-to-plait scalp, C2 r10. Pure numpy; shares the existing hair material.

Each hemisphere has one swept backing patch, feathered roots and tapered overlay locks.
Its longitudinal coordinate follows hair from the root to the centre plait, so the
irregular relief, larger locks and atlas fibres converge without a new runtime material.
"""
import math
import numpy as np


def scalp_flow(skin_dist, hc, s=1.0, nu=34, nv=15):
    from seraphine_hair_cards import _base_radius, _dir
    hc = np.asarray(hc, float)
    u = np.linspace(0, 1, nu + 1)
    v = np.linspace(0, 1, nv + 1)**1.35
    # Front hairline -> temple -> over ear -> nape. Ends disappear under the plait.
    az = np.interp(u, [0, .24, .44, .59, .76, 1], [0, 45, 76, 101, 134, 180])
    # A low, curved temple continues in front of and above the ear, then behind it.
    # The previous straight 30 -> 15 degree boundary exposed a shaved triangular slab.
    el = np.interp(u, [0, .12, .24, .36, .44, .53, .59, .76, 1],
                   [27, 19, -7, -30, -25, -24, -26, -29, -33])
    target = np.interp(u, [0, .24, .44, .59, .76, 1], [57, 32, 4, -16, -29, -33])
    out = []
    for side in (1, -1):
        roots = np.array([_dir(math.radians(side*a), math.radians(e)) for a,e in zip(az, el)])
        ends = np.array([_dir(math.pi, math.radians(e)) for e in target])
        # Great-circle sweep, bowed upward midway to give the side locks a curved, descending fan.
        dot = np.clip(np.sum(roots*ends,axis=1), -.999999, .999999)
        theta = np.arccos(dot)
        D = (np.sin((1-v[None,:])*theta[:,None])[...,None]*roots[:,None,:] +
             np.sin(v[None,:]*theta[:,None])[...,None]*ends[:,None,:]) / np.sin(theta)[:,None,None]
        D[:,:,2] += .10*np.sin(np.pi*v)[None,:]*np.sin(np.pi*u)[:,None]
        D /= np.linalg.norm(D,axis=2,keepdims=True)
        # Radial envelope comes from the skull/cap, never the old horizontal lock supports.
        R = _base_radius(skin_dist, hc, D.reshape(-1,3), sigma=2.2).reshape(D.shape[:2])
        U,V = np.meshgrid(u,v,indexing='ij')
        group, _ = _clump_field(U, V)
        clump = .002*group*np.sin(np.pi*U)**.35
        volume = .006 + .005*np.sin(np.pi*V)**.8
        # The front centre has a fuller swept crest; all roots grow smoothly from the cap.
        volume += .004*np.exp(-((U-.15)/.25)**2)*np.sin(np.pi*V)
        root = np.clip(V/.12,0,1); root = root*root*(3-2*root)
        lift = (.002 + (volume+clump)*root)*s
        P = hc + D*(R+lift)[...,None]
        # Same boundary on both halves. The terminal edge is hidden inside the braid.
        du,dv = np.gradient(P,axis=0),np.gradient(P,axis=1)
        N = np.cross(du,dv)
        N *= np.where(np.sum(N*D,axis=2)>0,1,-1)[...,None]
        N /= np.maximum(np.linalg.norm(N,axis=2,keepdims=True),1e-12)
        N=.40*N+.60*D; N/=np.linalg.norm(N,axis=2,keepdims=True)
        N[0,:,0] = 0; N[0] /= np.linalg.norm(N[0],axis=1,keepdims=True)
        # Reserved continuous opaque flow patches: atlas strips 4/5, same material as braid/wisps.
        # A hemisphere is nearly square in metres. Mapping it to a 128x800 strip
        # selected mip 2-3 and erased every fine fibre across U. Use a square
        # 115x118 texel patch, keeping isotropic texel density without shader changes.
        k=4 if side==1 else 5
        UV = np.stack([(k+.05+.90*U)/8, 1-(.05+.115*V)],axis=2)
        Q=[]
        for i in range(nu):
            for j in range(nv):
                a=i*(nv+1)+j
                Q.append((a,a+nv+1,a+nv+2,a+1))
        out.append(dict(kind='scalp_flow',verts=P.reshape(-1,3),normal=N.reshape(-1,3),uv=UV.reshape(-1,2),
                        quads=np.array(Q,np.int64),tris=np.empty((0,3),np.int64),grid_shape=(nu+1,nv+1)))
    return out


def _clump_field(u, v):
    """Unequal, curved groups; no periodic stamped relief across the scalp."""
    centres = np.array([.035, .165, .345, .485, .69, .875, 1.04])
    widths = np.array([.073, .10, .078, .11, .13, .085, .10])
    group = np.zeros(np.broadcast_shapes(u.shape, v.shape))
    for i, (c, w) in enumerate(zip(centres, widths)):
        bend = (.018 + .008*(i%3))*np.sin(np.pi*v)*(1 if i%2 else -1)
        ridge = np.exp(-((u-c-bend)/w)**2*2.4)
        group += ridge*(.68+.24*np.sin(i*2.1+v*2.2))
    return np.clip(group,0,1), centres


def layered_locks(shells, s=1.0):
    """Broad tapered locks cross the continuous fan and tuck beneath the plait.

    Each broad lock grows from the backing fan, with a separate 16-28 mm arched crest.
    Its irregular widths and depth make the scalp silhouette read as gathered volumes.
    This avoids both floating plates and the former horizontal tier endings.
    """
    out=[]
    for shell in shells:
        P=shell['verts'].reshape(*shell['grid_shape'],3)
        N=shell['normal'].reshape(*shell['grid_shape'],3)
        def sample(A,u,v):
            x=np.clip(u,0,1)*(A.shape[0]-1); y=np.clip(v,0,1)*(A.shape[1]-1)
            i=np.minimum(x.astype(int),A.shape[0]-2); j=np.minimum(y.astype(int),A.shape[1]-2)
            a=(x-i)[...,None];b=(y-j)[...,None]
            return (A[i,j]*(1-a)*(1-b)+A[i+1,j]*a*(1-b)+A[i,j+1]*(1-a)*b+A[i+1,j+1]*a*b)
        for k,(centre,width,start) in enumerate(((.025,.19,.008),(.12,.23,.018),(.235,.24,.01),(.38,.26,.025),(.55,.26,.012),(.74,.27,.018),(.92,.24,.012))):
            t=np.linspace(0,1,13)[:,None]; x=np.linspace(-1,1,7)[None,:]
            vv=start+(1-start)*t
            # Ends are staggered around the braid, producing a gathered rather than cut junction.
            vv=vv+np.zeros_like(x)
            width_t=width*(.58+.42*np.sin(np.pi*t)**.65)*(1-.90*t**5)
            uu=centre+(.025 if k%2 else -.025)*np.sin(np.pi*t)+x*width_t/2
            pos=sample(P,uu,vv); normal=sample(N,uu,vv)
            normal/=np.linalg.norm(normal,axis=2,keepdims=True)
            rounded=np.clip(1-x*x,0,1)**1.25*np.sin(np.pi*t)**.7
            pos+=normal*((-.0015+(.020,.026,.022,.028,.018,.022,.016)[k]*rounded)*s)[...,None]
            # Follow the rounded lock's own surface; reusing the shell normal hid
            # all volume and left only the intersection line visible.
            a,b=np.gradient(pos,axis=0),np.gradient(pos,axis=1)
            lock_normal=np.cross(a,b)
            lock_normal*=np.where(np.sum(lock_normal*normal,axis=2)>0,1,-1)[...,None]
            lock_normal/=np.maximum(np.linalg.norm(lock_normal,axis=2,keepdims=True),1e-12)
            lock_normal=normal*.45+lock_normal*.55
            lock_normal/=np.linalg.norm(lock_normal,axis=2,keepdims=True)
            # A narrow opaque atlas interior; long fibres follow the panel into the braid.
            strip=k%4; uv=np.stack([np.broadcast_to((strip+.15+.70*(x+1)/2)/8,pos.shape[:2]),
                                    np.broadcast_to(1-(.10+.64*t),pos.shape[:2])],axis=2)
            q=[]
            for j in range(12):
                for i in range(6):
                    a=j*7+i;q.append((a,a+1,a+8,a+7))
            out.append(dict(kind='swept_lock',verts=pos.reshape(-1,3),normal=lock_normal.reshape(-1,3),
                            uv=uv.reshape(-1,2),quads=np.array(q),tris=np.empty((0,3),np.int64)))
    return out


def flow_strip(rng,H,W,pal):
    """Strand field with feathered roots; vertical UV follows the sweep into the braid.

    Broad group shading and fine fibres are continuous along the entire sweep. Highlights
    are painted along fibres and modulated by the existing tangent normal map.
    """
    from seraphine_hair_cards import _srgb
    u=(np.linspace(0,1,W)[None,:]-.05)/.90; v=(np.linspace(0,1,H)[:,None]-.05)/.115
    base=pal.get('hair',_srgb(126,40,9))
    group,_=_clump_field(u,v)
    strand_phase=2*np.pi*(51*u+.70*np.sin(2*np.pi*3.3*u)+.16*np.sin(v*5+u*7))
    fibre=(.5+.5*np.cos(strand_phase))**4
    fine=.5+.5*np.sin(2*np.pi*73*u+v*2)
    val=.87+.10*group+.045*fibre+.015*fine
    rgb=base[None,None,:]*val[...,None]
    sheen=np.exp(-((v-.40-.10*np.sin(u*5))/.17)**2)*(.35+.65*group)
    hi=pal.get('hair_hi',_srgb(232,138,66))
    rgb += (hi-rgb)*(.08*fibre*(.28+.72*sheen))[...,None]
    height=.10*group+.04*fibre+.01*fine
    # The first ~3 mm break into fine roots. No opaque mesh-cut hairline.
    edge=.012+.012*(.5+.5*np.sin(u*239+np.sin(u*61)*2))
    alpha=np.clip((v-edge)/.025,0,1)+np.zeros_like(u)
    return alpha,rgb,height,fibre


def edge_wisps(shells, tendrils, skin_dist, skin_grad, s=1.0):
    out=[]
    for shell in shells:
        shape=shell['grid_shape']
        P=shell['verts'].reshape(*shape,3)
        N=shell['normal'].reshape(*shape,3)
        for i in (round((shape[0]-1)*f) for f in (.16,.26)):
            path=P[i,:8].copy()+N[i,:8]*.0008*s
            widths=np.linspace(.011,.004,len(path))*s
            out.append(dict(kind='hairline',path=path,normal=N[i,:8],width=widths,
                            strip=6+(i%2),flip=False,cup=0))
    # Old independent cheek tendrils made the isolated red temple decal. The new
    # wisps share the lower hairline and sweep back with it, rather than lying on skin.
    return out


def temple_locks(skin_dist, hc, s=1.0):
    from seraphine_hair_cards import _base_radius, _dir
    hc=np.asarray(hc,float); out=[]
    for side in (1,-1):
        t=np.linspace(0,1,15); x=np.linspace(-1,1,5)
        az=np.interp(t,[0,.25,.55,.80,1],[38,47,58,70,91])
        el=np.interp(t,[0,.25,.55,.80,1],[12,-2,-19,-31,-39])
        D=np.array([_dir(math.radians(side*a),math.radians(e)) for a,e in zip(az,el)])
        R=np.minimum(_base_radius(skin_dist,hc,D),.108*s)
        C=hc+D*(R+(.004+.009*np.sin(np.pi*t))*s)[:,None]
        T=np.gradient(C,axis=0); T/=np.linalg.norm(T,axis=1,keepdims=True)
        Sd=np.cross(T,D);Sd/=np.linalg.norm(Sd,axis=1,keepdims=True)
        width=(.010+.018*np.sin(np.pi*t)**.6)*(1-.95*t**4)*s
        P=C[:,None,:]+Sd[:,None,:]*x[None,:,None]*width[:,None,None]/2
        P+=D[:,None,:]*(.0035*(1-x*x)[None,:]*np.sin(np.pi*t)[:,None]*s)[...,None]
        N=np.cross(np.gradient(P,axis=0),np.gradient(P,axis=1));N*=np.where(np.sum(N*D[:,None,:],axis=2)>0,1,-1)[...,None]
        N/=np.linalg.norm(N,axis=2,keepdims=True)
        strip=1 if side==1 else 2
        uv=np.stack([np.broadcast_to((strip+.18+.64*(x+1)/2)/8,P.shape[:2]),np.broadcast_to(1-(.1+.64*t[:,None]),P.shape[:2])],axis=2)
        q=[]
        for j in range(14):
            for i in range(4):
                a=j*5+i;q.append((a,a+1,a+6,a+5))
        out.append(dict(kind='temple_lock',verts=P.reshape(-1,3),normal=N.reshape(-1,3),uv=uv.reshape(-1,2),quads=np.array(q),tris=np.empty((0,3),np.int64)))
    return out
