"""Brann r19 team hair: buried-root lens sheets over a continuous opaque volume.
Only writes the hair-owned part/scratch trees. Run Blender through blender-run.mjs.
"""
import argparse
import json
import math
import os
import struct
import sys
import time
import zlib
from pathlib import Path

import numpy as np

CONFIG = {
    "seed": 19031,
    "iter": 4,
    "rings": 32,
    "cross": 9,
    "crown_lift": .017,
    "root_bury": .006,
    "root_rigid_m": .040,
    "edge_thickness": .0009,
    "spine": .008,
    "fringe": True,
    "short_over_long": True,
    "under_nape_width": .218,
    "supported_volume": True,
    "under_nape_tip": 1.48,
    "lanes": 5,
    "roughness": [.83, .69, .88, .76, .59],
    "strand_rgb": [31, 32, 35],
    "out": "progress/tmp/brann_team/parts/hair",
    "scratch": "progress/tmp/brann_team/hair",
}
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import brann_team as T


def unit(x):
    x = np.asarray(x, float)
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)


def curve(points, n):
    p = np.asarray(points, float)
    out = []
    for t in np.linspace(0, len(p)-1, n):
        i = min(int(t), len(p)-2)
        f = t-i
        a,b,c,d = p[max(i-1,0)],p[i],p[i+1],p[min(i+2,len(p)-1)]
        out.append(.5*(2*b+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f))
    return np.array(out)


def png(path, a):
    """Write exact sRGB/non-color bytes without color management or external packages."""
    a = np.uint8(np.clip(a, 0, 255))
    h,w,c = a.shape
    def chunk(k,v):
        return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
    raw = b''.join(b'\x00'+row.tobytes() for row in a)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6 if c==4 else 2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b''))


def build_tiles(cfg):
    """Five 240 px lanes; top 75% opaque core, bottom 20% separate fringe region."""
    w,h = 1264,2048
    rng = np.random.default_rng(cfg['seed'])
    yy,xx = np.mgrid[0:h,0:w]
    # PNG rows top-down, local tile V points up.
    v = 1-yy/(h-1)
    lane = np.minimum(xx*cfg['lanes']//w, cfg['lanes']-1)
    u = (xx*cfg['lanes']/w)%1
    phase = u + .008*np.sin(v*12+lane*2)+.003*np.sin(v*31+lane)
    broad = .5+.5*np.sin(phase*2*np.pi*19+lane*1.7)
    fine = .5+.5*np.sin(phase*2*np.pi*83+lane*.8)
    micro = rng.normal(0,.45,(h,w))
    mod = .82+.25*broad+.13*fine+.06*np.sin(phase*2*np.pi*7)
    rgb = np.array(cfg['strand_rgb'])[None,None,:]*mod[...,None]+micro[...,None]
    # Natural, uneven strand end positions inside the fringe-only UV band.
    ends = .012+.15*(.5+.5*np.sin(u*2*np.pi*21+lane))**2
    ends += .025*(.5+.5*np.sin(u*2*np.pi*67))
    alpha = np.where(v>.235,1,np.clip((v-ends)/.006+.5,0,1))
    # Fringe sides feather, cores remain completely opaque and padded.
    alpha = np.where(v<.235,alpha*np.clip(np.minimum(u,1-u)*55,0,1),alpha)
    alb = np.concatenate([rgb,alpha[...,None]*255],-1)
    rough = np.take(cfg['roughness'],lane)+.025*(fine-.5)
    orm = np.stack([np.full_like(rough,255),rough*255,np.zeros_like(rough)],-1)
    # Low-amplitude tangent strand normals, no carved channels.
    nx=.065*np.sin(phase*2*np.pi*83)+.035*np.sin(phase*2*np.pi*19)
    ny=.006*np.cos(v*19+phase*20)
    normal=np.stack([128+nx*127,128+ny*127,128+np.sqrt(1-nx*nx-ny*ny)*127],-1)
    out=Path(cfg['out'])/'tiles';out.mkdir(parents=True,exist_ok=True)
    for k,a in [('albedo',alb),('orm',orm),('normal',normal)]: png(out/f'mane_{k}.png',a)


class Mesh:
    def __init__(self):
        self.p=[];self.f=[];self.uv=[];self.along=[];self.rigid=[];self.groups=[]

    def add(self,p,f,uv,along=None,rigid=False,group=''):
        off=len(self.p);self.p.extend(p);self.f.extend(np.array(f)+off);self.uv.extend(uv)
        self.along.extend(np.zeros(len(p)) if along is None else along)
        self.rigid.extend([rigid]*len(p));self.groups.append((group,off,len(self.p)))

    def save(self,name,cfg,replaces,alpha=False):
        import bpy,bmesh
        p=np.asarray(self.p);f=np.asarray(self.f,dtype=int)
        tri=p[f];valid=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)>1e-10
        f=f[valid];source_uv=np.array(self.uv)[valid]
        me=bpy.data.meshes.new(name);me.from_pydata(p.tolist(),[],f.tolist());me.update()
        bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
        # Preserve UV corner association if normal repair flipped winding.
        nf=np.array([list(poly.vertices) for poly in me.polygons])
        uv=source_uv
        for i in np.flatnonzero(np.any(nf!=f,axis=1)):
            uv[i]=uv[i,[list(f[i]).index(v) for v in nf[i]]]
        f=nf
        for group,start,end in self.groups:
            if group=='under_scalp':continue
            ids=np.flatnonzero(np.all((f>=start)&(f<end),axis=1))
            tris=p[f[ids]]
            vol=np.sum(np.einsum('ij,ij->i',tris[:,0],np.cross(tris[:,1],tris[:,2])))/6
            if vol<0:
                f[ids]=f[ids][:,::-1];uv[ids]=uv[ids][:,::-1]
        # Rebuild after per-component winding fixes so saved normals follow final topology.
        bpy.data.meshes.remove(me)
        me=bpy.data.meshes.new(name);me.from_pydata(p.tolist(),[],f.tolist());me.update()
        for poly in me.polygons:poly.use_smooth=True
        me.update()
        n=np.array([me.vertices[int(v)].normal[:] for v in f.ravel()]).reshape(-1,3,3)
        n=unit(n)
        bones=['head','hair_1','hair_2','hair_3']
        d=np.clip((1.865-p[:,2])/.43,0,1)*3
        w=np.maximum(1-np.abs(d[:,None]-np.arange(4)[None,:]),0)
        w/=w.sum(1,keepdims=True)
        w[np.array(self.rigid)| (np.array(self.along)<cfg['root_rigid_m'])]=[1,0,0,0]
        result=T.save_part(cfg['out'],name,P=p,F=f,UV=uv,N=n,W=w,bones=bones,tile='mane',meta={
            'role':'hair','replaces':replaces,'author':'GPT-6.1 Sol','alpha':alpha,
            'notes':'Stacked five high-resolution lanes. Core UV v>=.27 is fully opaque; fringe v=.005..22. Roots head-rigid 40mm.',
            'groups':[{'name':g[0],'start':g[1],'end':g[2]} for g in self.groups]})
        bpy.data.meshes.remove(me)
        return result


def lane_uv(u,t,lid,fringe=False):
    # 10px gutters in each 253px lane; 227px actually sampled across each lock.
    x=(lid%5+( .05+.90*u))/5
    v=(.008+.212*(1-t)) if fringe else (.28+.69*(1-t))
    if not fringe: v-=.010*(lid%3)
    return [x,v]


def skull_bvh(d):
    from mathutils.bvhtree import BVHTree
    return BVHTree.FromPolygons(d.P.tolist(),d.F[d.faces('face','scalp','head_other')].tolist(),all_triangles=True)


def scalp_top(bvh,x,y):
    from mathutils import Vector
    hit=bvh.ray_cast(Vector((x,y,2.2)),Vector((0,0,-1)))
    return np.array(hit[0]) if hit[0] else np.array([x,y,1.91])


def build_under_volume(cfg,d,m):
    """Continuous dark support from skull to nape. Hidden by the overlapping outer groups."""
    import bpy,bmesh
    # Reuse ONLY the donor skull surface as a dark, fitted support. No front band.
    f=d.F[d.faces('scalp')];used=np.unique(f);remap=np.full(len(d.P),-1,int);remap[used]=np.arange(len(used))
    p=d.P[used]+d.N[used]*.0015
    me=bpy.data.meshes.new('support');me.from_pydata(p.tolist(),[],remap[f].tolist());me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8);bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new('support',me);bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    mod=ob.modifiers.new('hidden_support_budget','DECIMATE');mod.ratio=.20
    bpy.ops.object.modifier_apply(modifier=mod.name)
    pp=np.array([v.co[:] for v in ob.data.vertices]);ff=np.array([list(f.vertices) for f in ob.data.polygons],int)
    uv=np.array([lane_uv(np.clip((q[0]+.16)/.32,0,1),np.clip((1.96-q[2])/.26,0,1),2) for q in pp])
    m.add(pp,ff,uv[ff],rigid=True,group='under_scalp')
    bpy.data.objects.remove(ob,do_unlink=True)
    # Broad, skull-conforming support sits below the outer lens spines; closes hollow arches.
    if cfg['supported_volume']:
        cfg['_bvh']=skull_bvh(d)
        pts=[[0,-.077,1.900],[0,-.018,1.954],[0,.038,1.964],
             [0,.119,1.917],[0,.177,1.822],[0,.202,1.675],[0,.205,1.515]]
        sweep_lock(cfg,m,None,pts,.330,.004,
                   lambda t:np.array([0,.15+t,1-1.65*t]),2,'crown_support',rigid=True,under=True)
    # Nape lens mass overlaps scalp rear by 40mm; widths terminate above outer tips.
    points=[[0,.130,1.82],[0,.176,1.73],[0,.198,1.62],[0,.204,1.50],[.005,.198,cfg['under_nape_tip']]]
    sweep_lock(cfg,m,None,points,cfg['under_nape_width'],.022,lambda t:np.array([0,1,0]),2,'under_nape',rigid=True,under=True)


def sweep_lock(cfg,m,fr,points,width,thick,outward,lid,name,rigid=False,under=False):
    """A closed flattened lens: shared sharp edges, broad root, separate width/depth profiles.
    No elliptical tubes; both surfaces meet at <1mm edges, 6-14mm spine.
    """
    nr,nc=cfg['rings'],cfg['cross']
    c=curve(points,nr+1)
    dist=np.r_[0,np.cumsum(np.linalg.norm(np.diff(c,axis=0),axis=1))]
    p=[];us=[];along=[];frames=[]
    for i,center in enumerate(c[:-1]):
        t=i/nr;tan=unit(c[min(i+1,nr)]-c[max(0,i-1)])
        n=unit(outward(t));n=unit(n-tan*np.dot(n,tan));u=unit(np.cross(tan,n))
        # Smooth broad buried roots; only final third tapers substantially.
        shape=np.interp(t,[0,.12,.40,.65,.83,1],[.92,1,.96,.78,.43,0])
        if under:shape=np.interp(t,[0,.2,.6,1],[.62,1,.80,0])
        half=width*.5*shape
        frames.append((center,u,n,half))
        # Upper left -> right, underside right -> left; edge vertices shared.
        xs=list(np.linspace(-1,1,nc))+list(np.linspace(1,-1,nc)[1:-1])
        for j,x in enumerate(xs):
            top=j<nc
            lens=(max(0,1-x*x))**.72
            rootfade=max(.12,min(1,dist[i]/.045))
            tipfade=min(1,(1-t)/.26)**.7
            depth=(thick*rootfade*tipfade if top else -.0012*tipfade)*lens
            # Fine, irregular broad fibre ridges; never round longitudinal lobes.
            depth+=.00045*np.sin(x*13+t*6+lid)*lens*rootfade*tipfade if top else 0
            q=center+u*half*x+n*depth
            if (name.startswith('crown') and t<.61) or (name.startswith('side_sweep') and t<.27):
                from mathutils import Vector
                loc,sn,_,_=cfg['_bvh'].find_nearest(Vector(q))
                if loc is not None:
                    end=.61 if name.startswith('crown') else .27
                    lift=np.interp(t,[0,.10,.24,.40,.61],[-cfg['root_bury'],.003,.013,cfg['crown_lift'],.025])
                    if name=='crown_support':lift-=.003
                    blend=1 if t<end-.08 else (end-t)/.08
                    qq=np.array(loc)+np.array(sn)*(lift+depth)
                    q=q*(1-blend)+qq*blend
            p.append(q);us.append(lane_uv((x+1)/2,t,lid));along.append(dist[i])
    ns=nc*2-2;f=[]
    for i in range(nr-1):
        for j in range(ns):
            a=i*ns+j;b=i*ns+(j+1)%ns
            f.extend([(a,b,b+ns),(a,b+ns,a+ns)])
    # Planar root end is deep in scalp/another lock; no rounded root rim.
    r=len(p);p.append(c[0]);us.append(lane_uv(.5,0,lid));along.append(0)
    tip=len(p);p.append(c[-1]);us.append(lane_uv(.5,1,lid));along.append(dist[-1])
    for j in range(ns):f.extend([(r,(j+1)%ns,j),(tip,(nr-1)*ns+j,(nr-1)*ns+(j+1)%ns)])
    m.add(p,f,np.array(us)[f],along,rigid,name)
    if fr is not None and cfg['fringe']:
        # Surface-rooted strips extend beyond a lock's taper as individual broken strand clumps.
        for k,start in enumerate([.76,.83,.88]):
            ids=np.unique(np.linspace(int(start*nr),nr-1,8).astype(int))
            fp=[];fu=[];fa=[]
            for h,i in enumerate(ids):
                center,u,n,half=frames[i];t=h/(len(ids)-1)
                side=(k-1)*.55
                # Start ON the opaque top surface, ending below / beyond its taper.
                cc=center+u*half*side+n*(thick*max(0,1-side*side)**.72*min(1,(1-i/nr)/.26)**.7+.0003)
                cc+=(c[-1]-c[max(0,nr-3)])*max(0,t-.65)*1.8
                ww=width*(.055 if k!=1 else .085)*(1-.82*t)
                for s in [-1,1]:
                    fp.append(cc+u*s*ww);fu.append(lane_uv((s+1)/2,t,lid,True));fa.append(dist[i])
            ff=[]
            for h in range(len(ids)-1):
                a=h*2;ff.extend([(a,a+1,a+3),(a,a+3,a+2)])
            fr.add(fp,ff,np.array(fu)[ff],fa,False,name+'_tip'+str(k))


def build_primary_locks(cfg,d,m,fr):
    bvh=skull_bvh(d);cfg['_bvh']=bvh;specs=[]
    # Five crown groups flow from the donor hairline over the skull and overlap down the back.
    for i,(x,width,tip) in enumerate([(-.060,.048,1.65),(-.030,.060,1.55),(.003,.074,1.69),(.034,.062,1.60),(.061,.045,1.72)]):
        if cfg['short_over_long']:tip=[1.76,1.68,1.79,1.72,1.80][i]
        from mathutils import Vector
        hit=bvh.ray_cast(Vector((x,-.24,1.900-abs(x)*.27)),Vector((0,1,0)))
        root=np.array(hit[0])-np.array(hit[1])*cfg['root_bury'] if hit[0] is not None else scalp_top(bvh,x,-.065)-[0,0,cfg['root_bury']]
        pts=[root,scalp_top(bvh,x,-.025)+[0,0,.009],scalp_top(bvh,x*.93,.035)+[0,0,cfg['crown_lift']],
             [x*1.12,.112,1.933-abs(x)*.26],[x*1.40,.183,max(1.84,tip+.085)],[x*1.48+.013*np.sin(i),.212,tip+.06],[x*1.25+.025*np.sin(i*2),.218,tip]]
        specs.append((pts,width,.007+[.001,.003,.004,.001,.002][i],lambda t:np.array([0,.15+t,1-1.65*t]),i,'crown_'+str(i)))
    # Two side groups per side: one wide swept layer and a slim face-framing lock.
    for si,s in enumerate([-1,1]):
        pts=[[s*.076,-.010,1.873],[s*.096,.026,1.877],[s*.132,.093,1.811],[s*.161,.156,1.71],[s*.156,.195,1.58],[s*.147,.212,(1.55 if cfg['short_over_long'] else 1.47)+si*.03]]
        specs.append((pts,.078,.008,lambda t,s=s:np.array([s*.85,.55,.08]),5+si*2,'side_sweep_'+str(si)))
        pts=[[s*.074,-.039,1.873],[s*.098,-.060,1.84],[s*.112,-.071,1.775],[s*.124,-.093,1.70],[s*.124,-.126,1.63],[s*.136,-.139,1.58+si*.012]]
        specs.append((pts,.029,.006,lambda t,s=s:np.array([s*.8,-.6,.02]),6+si*2,'face_frame_'+str(si)))
    # Three broad lower back groups cover the entire nape, staggered below short crown feathers.
    for j,(x,width,z) in enumerate([(-.086,.140,1.41),(.0,.042,1.365),(.083,.112,1.39)]):
        pts=[[x,.119,1.83],[x*1.18,.166,1.77],[x*1.2,.208,1.67],[x*1.12+.012*np.sin(j),.235,1.55],[x*.92+.018*np.sin(j+1),.232,1.44],[x*.75+.012*np.cos(j),.219,z]]
        specs.append((pts,width,[.008,.006,.009][j],lambda t:np.array([0,1,.10]),9+j,'back_'+str(j)))
    for pts,w,th,n,lid,name in specs:sweep_lock(cfg,m,fr,pts,w,th,n,lid,name)
    return specs


def preview(out):
    import build_hero_brann_team as B
    # Preview material cache is keyed by tile, so opaque + fringe share a material.
    # Wire alpha on that shared groom material; core samples use the fully opaque UV band.
    original=B.material_for
    def material(name,ims,alpha=False,cutoff=.45):return original(name,ims,alpha=alpha or name=='M_hero_brann_mane',cutoff=cutoff)
    B.material_for=material
    old=sys.argv;sys.argv=['preview','--','--preview-role','hair','--out',str(out)]
    try:
        B.main()
        # Imported donor leaves an unused material with the same name; Blender may append .001.
        # Preserve r18's body rim hint using the actual exported names as well as the groom hint.
        full=Path(out)/'hero_brann.glb'
        raw=full.read_bytes();ln=struct.unpack_from('<I',raw,12)[0];js=json.loads(raw[20:20+ln])
        B.patch_extras(str(full),{m['name']:{'rim':.14} for m in js.get('materials',[])})
        # Part-only hygiene audit is separate from the retained donor's known debris.
        import bpy
        objs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE' or o.name.startswith('hair_')]
        path=str(Path(out)/'hair_only.glb')
        B.pipeline.export_glb(path,objs,scene_name='brann_hair')
        B.patch_extras(path,{'M_hero_brann_mane':{'rim':.14,'alpha':'MASK','cutoff':.45}})
    finally:sys.argv=old


def main():
    a=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true');ap.add_argument('--iter',type=int,default=CONFIG['iter'])
    args=ap.parse_args(a);cfg=dict(CONFIG,iter=args.iter)
    t=time.time();d=T.Donor();m=Mesh();fr=Mesh()
    build_tiles(cfg);print(f'[brann-hair] stage tiles done in {time.time()-t:.1f}s',flush=True)
    build_under_volume(cfg,d,m);specs=build_primary_locks(cfg,d,m,fr)
    # First root of every visible group is rigid; underside volume is rigid head.
    mm=m.save('mane',cfg,['mane']);fm=fr.save('mane_fringe',cfg,[],True) if cfg['fringe'] else {'tris':0}
    if mm['tris']+fm['tris']>16000:raise RuntimeError('mane exceeds the 16000 triangle role budget')
    # Measured crown clearance on the three upper groups, not a target copied into the report.
    from mathutils import Vector
    lifts=[]
    for name,start,end in m.groups:
        if name not in ('crown_1','crown_2','crown_3'):continue
        for ring in range(8,15):
            q=np.array(m.p[start+ring*(cfg['cross']*2-2)+cfg['cross']//2])
            loc,sn,_,_=cfg['_bvh'].find_nearest(Vector(q))
            lifts.append(float(np.dot(q-np.array(loc),np.array(sn))*1000))
    crown=[round(min(lifts),2),round(max(lifts),2)]
    report={'crown_lift_mm':crown,'root_burial_mm':cfg['root_bury']*1000,'front_lock_tip_z':[specs[6][0][-1][2],specs[8][0][-1][2]],'back_tip_z':[s[0][-1][2] for s in specs[-3:]],'usable_lane_px':1264/cfg['lanes']*.90,'iter':args.iter,'locks':len(specs),'width_ratio':max(s[1] for s in specs)/min(s[1] for s in specs),'tris':{'mane':mm['tris'],'fringe':fm['tris']},'config':{k:v for k,v in cfg.items() if not k.startswith('_')}}
    T.save_json(str(Path(cfg['scratch'])/f'iter{args.iter}_report.json'),report)
    print(f'[brann-hair] stage geometry done in {time.time()-t:.1f}s {report["tris"]}',flush=True)
    print(json.dumps(T.check_part(cfg['out']),indent=1),flush=True)
    if args.preview:preview(Path(cfg['scratch'])/'preview'/str(args.iter))


if __name__=='__main__':main()
