"""Stage 4 (Serpent Keep Gates) r33 STRUCTURAL SUPPLEMENT -> env_stage4_r33_structure.glb

Nine complete replacement modules (wall, wall_door, tower, tower_spire, gatehouse + wall_lo, tower_lo, tower_spire_lo,
gatehouse_lo): mixed short/medium/long coursed ashlar (0.60 / 1.08 / 1.80 m families, selected taller bonds and quoins)
over a continuous recessed mortar bed, exact donor module frames / glTF bounds / RGBA masks (0 stone, .25 iron, .5 wood,
.75 slate). The game loads it beside the donor kit (public/assets/models/env_stage4_kit.glb, built by
blender/build_env_stage4_kit.py, untouched) and src/levels/stages/stage4/kit.js overlays these names; every other module
(serpent statue, gargoyle, sigil, brazier, doors, portcullis) still comes from the donor GLB.
First build by Sol 6.1; single masonry fix by Fable 5.1. Rehomed by exclusive r33 Stage4 integration.

Parts: blender/env_stage4_r33/kit_fork.py (fork of the donor builder: shared Builder / lathe / makers),
       blender/env_stage4_r33/masonry.py (CONFIG: seeds, length families, budgets, palette; installs the ashlar makers),
       blender/env_stage4_r33/donor-stats.json (donor per-module glTF bounds, frozen at r33),
       read-only donor GLB (only for --sheets) public/assets/models/env_stage4_kit.glb sha256 DONOR_SHA below.
Run ONLY through the wrapper, CPU (no bake), e.g. a preview reproduction (output defaults to progress/tmp, never live):
  KCA_CYCLES_DEVICE=CPU node tools/blender-run.mjs --owner <you> --mem-mb 3500 -- -b --factory-startup \
      --python-exit-code 1 -P blender/build_env_stage4_r33_structure.py -- --preview [--sheets] [--out <path>]
Modes: --preview | --fast | --release (exactly one). --release refuses to overwrite an existing file. Writing anywhere
under public/ needs --publish, and the donor kit path is always refused. No SDF / clean_form path is used (asserted).
The shipped r33 release is byte-identical to its preview 4 (sha256 RELEASE_SHA below; see blender/env_stage4_r33/README.md).
"""
import argparse, hashlib, json, math, os, runpy, sys, time
from pathlib import Path
import bpy, bmesh, numpy as np

BLENDER=Path(__file__).resolve().parent
PKG=BLENDER/'env_stage4_r33'
ROOT=BLENDER.parent
DONOR_GLB=ROOT/'public'/'assets'/'models'/'env_stage4_kit.glb'
DONOR_SHA='d00e4884f20282fe182fc311f9802ad96b7994972f67621d3c3044950a1e3eb6'
FIRST_BUILD_SHA='08fe6cb2065061e18bdc88c2e72fb5e5b9d99b12da9f8e244a3771bfd5c89e1b'
RELEASE_SHA='271dbf6f39c1debd7bb33305ffff134276bb990f548f2d1d3ae9b15bd8706694'
sys.path.insert(0,str(PKG))
from masonry import CONFIG, install

def arguments():
    p=argparse.ArgumentParser()
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preview',action='store_true');mode.add_argument('--fast',action='store_true')
    mode.add_argument('--release',action='store_true')
    p.add_argument('--out',default=None,help='default progress/tmp/env_stage4_r33_structure/<mode>.glb (never live)')
    p.add_argument('--publish',action='store_true',help='allow an output under public/ (still never the donor kit)')
    p.add_argument('--only',default='wall,wall_door,tower,tower_spire,gatehouse')
    p.add_argument('--sheets',action='store_true')
    return p.parse_args(sys.argv[sys.argv.index('--')+1:])

CLEAN_AUDIT=[]

def hygiene(ob):
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    # No face-island deletion is permitted. Degenerate source lathe poles only.
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    loose=[v for v in bm.verts if not v.link_faces]
    CLEAN_AUDIT.append({'object':ob.name,'unused_zero_face_vertices':len(loose),'discarded_face_islands':0,'discarded_designed_triangles':0,
        'nonmanifold_edges': [{'a':list(e.verts[0].co),'b':list(e.verts[1].co),'faces':len(e.link_faces)} for e in bm.edges if len(e.link_faces)>2]})
    assert CONFIG.get('low_mode') or not loose, f'{ob.name}: unexpected loose vertices ({len(loose)})'
    if loose:
        assert all(not v.link_faces for v in loose)
        print('[r33] zero-face low bevel points removed',len(loose),'discarded triangles=0',flush=True)
        bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(ob.data);bm.free();ob.data.update()

def fit_envelope(ob, donor):
    """Constrain outer plinth/crenel envelope, leave central doorway/slits intact."""
    lo,hi=np.array(donor['bounds_gltf'],float)
    # glTF (x,y,z) == Blender (x,z,-y).
    wantlo=np.array([lo[0],-hi[2],lo[1]])
    wanthi=np.array([hi[0],-lo[2],hi[1]])
    P=np.array([v.co[:] for v in ob.data.vertices]);mn=P.min(0);mx=P.max(0)
    for ax in range(3):
        span=mx[ax]-mn[ax]; band=min(span*.12,.65)
        for edge,target,sgn in [(mn[ax],wantlo[ax],-1),(mx[ax],wanthi[ax],1)]:
            delta=target-edge
            if abs(delta)<1e-7:continue
            t=np.clip(1.-np.abs(P[:,ax]-edge)/band,0.,1.)
            P[:,ax]+=delta*t*t*(3.-2.*t)
    for v,p in zip(ob.data.vertices,P):v.co=p
    ob.data.update()

def render_sheet(obs,path,color='VERTEX',close=False):
    from lib import preview as pv
    pv.setup_workbench(color)
    hidden={o:o.hide_render for o in bpy.data.objects if o.type=='MESH'}
    for o in hidden:o.hide_render=o not in obs
    views=[]
    for i,ob in enumerate(obs):
        ob.location.x=i*45
        P=np.array([v.co[:] for v in ob.data.vertices])
        mn=P.min(0);mx=P.max(0);c=(mn+mx)*.5
        c[0]+=i*45
        if close: c=np.array([i*45+1.3,-1.6,5.2]);size=3.4
        else:size=max(mx-mn)*1.10
        views.append(dict(target=tuple(c),dist=size*2.0,yaw=12,pitch=5,ortho=size))
    pv.render_views(str(path),views,res=(450,600))
    for ob in obs:ob.location=(0,0,0)
    for ob,h in hidden.items():ob.hide_render=h

def main():
    t=time.time();a=arguments()
    mode='release' if a.release else 'fast' if a.fast else 'preview'
    out=Path(a.out).resolve() if a.out else ROOT/'progress'/'tmp'/'env_stage4_r33_structure'/f'{mode}.glb'
    assert out.is_relative_to(ROOT), 'output must stay inside the repository'
    assert out!=DONOR_GLB.resolve(), 'never overwrite the donor kit'
    assert a.publish or not out.is_relative_to(ROOT/'public'), 'output under public/ needs --publish'
    assert os.environ.get('KCA_CYCLES_DEVICE')=='CPU', 'non-bake job must use CPU wrapper'
    if a.release:assert not out.exists(),'one release only; do not overwrite final candidate'
    out.parent.mkdir(parents=True,exist_ok=True)
    ns={'__file__':str(PKG/'kit_fork.py'),'__name__':'env_stage4_r33_fork'}
    exec(compile((PKG/'kit_fork.py').read_text(),ns['__file__'],'exec'),ns)
    install(ns)
    original_box=ns['Builder'].box
    original_lathe=ns['Builder'].lathe
    def low_box(self,c,h,col,mask=0.,ch=.035,M=None):
        h=list(h)
        if self.name in ('tower','tower_spire') and 14.2<c[2]<15.1 and abs(h[2]-.12)<1e-6:
            h[2]=.14  # bearing overlap between the three real corbel steps
        P=np.array([(sx*h[0],sy*h[1],sz*h[2]) for sx in (-1,1) for sy in (-1,1) for sz in (-1,1)],float)
        if M is not None:P=P@np.asarray(M).T
        Q=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
        self.add(P+np.asarray(c),Q,[],col,mask)
    def low_lathe(self,prof,seg,*args,**kw):
        return original_lathe(self,prof,min(seg,12),*args,**kw)
    ns['meshutil'].clear_scene()
    # This task uses no SDF or clean_form; fail if a frozen sculpt is called.
    def forbidden(*_,**__):raise AssertionError('frozen SDF / clean_form path is out of scope')
    ns['sdf_mesh']=forbidden
    makers={'wall':lambda:ns['curtain_wall']('wall',seed=CONFIG['module_seeds']['wall']),
            'wall_door':lambda:ns['curtain_wall']('wall_door',seed=CONFIG['module_seeds']['wall_door'],door=True),
            'tower':lambda:ns['round_tower']('tower',seed=CONFIG['module_seeds']['tower']),
            'tower_spire':lambda:ns['round_tower']('tower_spire',spire=True,seed=CONFIG['module_seeds']['tower_spire']),
            'gatehouse':lambda:ns['gatehouse']('gatehouse',seed=CONFIG['module_seeds']['gatehouse'])}
    donor=json.loads((PKG/'donor-stats.json').read_text())
    obs=[];report={};fixstats={}
    for key in a.only.split(','):
        ob=makers[key]();ob.name=key;ob.data.name=key
        hygiene(ob);fit_envelope(ob,donor['modules'][key]);obs.append(ob)
        report[key]={'tris':ns['meshutil'].tri_count(ob),'budget':CONFIG['budgets'][key]}
        fs_=ns.get('FIX_STATS')
        fixstats[key]=json.loads(json.dumps(fs_)) if fs_ else None
        if fs_:
            for stat in fs_:
                if isinstance(fs_[stat], dict):
                    for family in fs_[stat]:fs_[stat][family]=0
                else:fs_[stat]=0
        assert report[key]['tris']<=CONFIG['budgets'][key]*1.05,report[key]
        if key in CONFIG['lod_targets']:
            # Dedicated Low construction preserves seats/roots; collapse of tiny
            # donor corbels and merlon feet had opened real gaps in preview QA.
            CONFIG['low_mode']=True
            ns['Builder'].box=low_box;ns['Builder'].lathe=low_lathe
            lo=makers[key]()
            ns['Builder'].box=original_box;ns['Builder'].lathe=original_lathe
            ns['meshutil'].triangulate(lo);hygiene(lo)
            CONFIG['low_mode']=False
            fit_envelope(lo,donor['modules'][key+'_lo'])
            lo.name=key+'_lo';lo.data.name=key+'_lo';obs.append(lo)
            report[lo.name]={'tris':ns['meshutil'].tri_count(lo),'budget':CONFIG['budgets'][lo.name]}
            assert report[lo.name]['tris']<=CONFIG['budgets'][lo.name]
        print('[r33] built',key,report[key],f'{time.time()-t:.1f}s',flush=True)
    # Preview matched donor / candidate at identical module and masonry framing.
    if a.sheets:
        hiobs=[o for o in obs if not o.name.endswith('_lo')]
        render_sheet(hiobs,out.parent/'candidate-vertex.png')
        render_sheet(hiobs,out.parent/'candidate-clay.png','SINGLE')
        render_sheet([o for o in hiobs if o.name in ('wall','wall_door')],out.parent/'candidate-close.png',close=True)
        for ob in obs:ob.hide_render=True
        old=set(bpy.data.objects)
        assert hashlib.sha256(DONOR_GLB.read_bytes()).hexdigest()==DONOR_SHA, 'donor kit changed: sheets compare against the r33 donor only'
        bpy.ops.import_scene.gltf(filepath=str(DONOR_GLB))
        donors=[o for o in bpy.data.objects if o not in old and o.type=='MESH' and o.name.split('.')[0] in a.only.split(',')]
        for ob in bpy.data.objects:
            if ob not in old and ob.type=='MESH' and ob not in donors:ob.hide_render=True
        render_sheet(donors,out.parent/'donor-vertex.png')
        render_sheet(donors,out.parent/'donor-clay.png','SINGLE')
        render_sheet([o for o in donors if o.name.split('.')[0] in ('wall','wall_door')],out.parent/'donor-close.png',close=True)
        for ob in bpy.data.objects:
            if ob not in old:ob.hide_render=True
        for ob in obs:ob.hide_render=False
    ns['meshutil'].select_only(obs,obs[0])
    bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
        export_yup=True,export_apply=False,export_texcoords=False,export_normals=True,
        export_materials='NONE',export_animations=False,export_vertex_color='ACTIVE',
        export_extras=False)
    report={'mode':mode,'config':CONFIG,'modules':report,'fix_stats':fixstats,'first_build_sha256':FIRST_BUILD_SHA,'donor_sha256':DONOR_SHA,'r33_release_sha256':RELEASE_SHA,
            'seconds':time.time()-t,'discarded_clean_form_islands':[],
            'clean_form_calls':0,'cleanup_audit':CLEAN_AUDIT,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
    out.with_suffix('.build.json').write_text(json.dumps(report,indent=2)+'\n')
    print('[r33] WROTE',out,report['sha256'],flush=True)

main()
