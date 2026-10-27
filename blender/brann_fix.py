"""r20 focused part edits on shipped r19; preserve original geometry and rig bytes.

Run through tools/blender-run.mjs. Builds use lossless WebP texture patches;
--release is the single final release. All positions, normals, tangents, sockets,
and non-kilt skin weights are retained verbatim. No Blender import/export reorder.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import brann_team as team

CONFIG = {
    "donor_sha": "0b96643273b711fc24bde1a3a275c9831a930d0b8dc972afd8366f154e9ec1e0",
    "seed": 20,
    "body_rim": .30,
    "groom_rim": .025,
    "groom_specular": .10,
    "cloth_rim": .015,
    "inner_factor": [.36, .30, .30, 1.0],
    "thigh_max": .18,
    "hips_min": .40,
    "hair_roughness": .96,
    "fur_roughness": .94,
    "flank_center": [-.1719, 1.1646, .0226],
}


def log(s):
    print('[brann-fix] ' + s, flush=True)


class GLB:
    def __init__(self, path):
        self.raw = open(path, 'rb').read()
        n = struct.unpack_from('<I', self.raw, 12)[0]
        self.js = json.loads(self.raw[20:20+n])
        self.buf = bytearray(self.raw[28+n:])

    def acc(self, i):
        a = self.js['accessors'][i]
        v = self.js['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        nc = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1, 'MAT4': 16}[a['type']]
        size = np.dtype(dt).itemsize
        return np.ndarray((a['count'], nc), dt, buffer=self.buf,
                          offset=v.get('byteOffset', 0)+a.get('byteOffset', 0),
                          strides=(v.get('byteStride', size*nc), size)).copy()

    def blob(self, data, target=None):
        self.buf.extend(b'\0' * ((-len(self.buf)) % 4))
        view = dict(buffer=0, byteOffset=len(self.buf), byteLength=len(data))
        if target:
            view['target'] = target
        self.buf.extend(data)
        self.js['bufferViews'].append(view)
        return len(self.js['bufferViews'])-1

    def array(self, source, data):
        a = copy.deepcopy(self.js['accessors'][source])
        for k in ('min', 'max', 'byteOffset', 'sparse'):
            a.pop(k, None)
        a.update(bufferView=self.blob(data.tobytes(), 34963 if a['type']=='SCALAR' else 34962), count=len(data))
        self.js['accessors'].append(a)
        return len(self.js['accessors'])-1

    def save(self, path):
        self.buf.extend(b'\0' * ((-len(self.buf)) % 4))
        self.js['buffers'][0]['byteLength'] = len(self.buf)
        jb = json.dumps(self.js, separators=(',', ':')).encode()
        jb += b' ' * ((-len(jb)) % 4)
        data = (struct.pack('<III', 0x46546c67, 2, 28+len(jb)+len(self.buf))
                + struct.pack('<II', len(jb), 0x4e4f534a)+jb
                + struct.pack('<II', len(self.buf), 0x004e4942)+self.buf)
        open(path, 'wb').write(data)


def region_vertices(P, donor):
    # Integer position keys avoid float32/float64 hashing differences.
    lookup = {}
    for r in donor.names:
        for vi in donor.verts_of(r):
            lookup.setdefault(tuple(np.rint(donor.P[vi]*1e6).astype(int)), r)
    pb = P[:, [0, 2, 1]].astype(float)
    pb[:, 1] *= -1
    return np.array([lookup.get(tuple(np.rint(p*1e6).astype(int)), 'new') for p in pb])


def reweight_kilt(glb, pr, selected, report):
    at = pr['attributes']
    P = glb.acc(at['POSITION'])
    F = glb.acc(pr['indices']).reshape(-1, 3)
    J, W = glb.acc(at['JOINTS_0']), glb.acc(at['WEIGHTS_0'])
    oldJ, oldW = J.copy(), W.copy()
    bones = [glb.js['nodes'][i]['name'] for i in glb.js['skins'][0]['joints']]
    ids = np.unique(F[selected])
    for vi in ids:
        x, z, front = P[vi]
        hem = np.clip((1.0-z)/.35, 0, 1)
        # Smooth angular partition across neighbouring spring chains. The front
        # and back share hips, rather than being pulled between opposing thighs.
        angle = math.atan2(x/.28, (front+.016)/.28) % (2*math.pi)
        sectors = ['F', 'L', 'B', 'R']
        q = angle/(math.pi/2)
        s = int(q) % 4
        blend = .5-.5*math.cos((q-int(q))*math.pi)
        level = min(3, max(1, 1+int(hem*2.999)))
        thigh = CONFIG['thigh_max']*hem*min(1, abs(x)/.16)
        hips = 1-(1-CONFIG['hips_min'])*hem
        chain = 1-hips-thigh
        weights = {'hips': hips, 'thigh_L' if x>=0 else 'thigh_R': thigh,
                   f'kilt_{sectors[s]}_{level}': chain*(1-blend),
                   f'kilt_{sectors[(s+1)%4]}_{level}': chain*blend}
        vals = sorted(((bones.index(b), w) for b,w in weights.items() if w>1e-7), key=lambda v:-v[1])[:4]
        J[vi] = 0
        W[vi] = 0
        total = sum(w for _,w in vals)
        for k,(j,w) in enumerate(vals):
            J[vi,k], W[vi,k] = j,w/total
    at['JOINTS_0'] = glb.array(at['JOINTS_0'], J)
    at['WEIGHTS_0'] = glb.array(at['WEIGHTS_0'], W)
    other = np.ones(len(P), bool)
    other[ids] = False
    assert np.array_equal(J[other],oldJ[other]) and np.array_equal(W[other],oldW[other])
    report['kilt'] = dict(vertices=len(ids), triangles=int(selected.sum()), thigh_max=CONFIG['thigh_max'],
                          hips_min=CONFIG['hips_min'], non_kilt_weight_delta=0)


def fix_flank(glb, pr, maps, report):
    at = pr['attributes']
    P, F, U = glb.acc(at['POSITION']), glb.acc(pr['indices']).reshape(-1,3), glb.acc(at['TEXCOORD_0'])
    C = P[F].mean(1)
    ti = int(np.argmin(np.linalg.norm(C-np.array(CONFIG['flank_center']),axis=1)))
    assert np.linalg.norm(C[ti]-CONFIG['flank_center']) < .006
    verts = F[ti]
    # This triangle is a separate ~1px atlas island. Put it in a padded, stable
    # skin patch in the unused spare tile. No position or normal edits.
    assert all(np.sum(F==v)==1 for v in verts)
    xy = np.array([[1800,1900],[1848,1900],[1824,1852]],np.float32)
    U[verts] = xy/2048
    glb.js['meshes'][1]['primitives'][0]['attributes']['TEXCOORD_0'] = glb.array(at['TEXCOORD_0'],U)
    for name, colour in [('body_albedo',[178,96,53,255]),('body_orm',[242,158,0,255]),('body_normal',[128,128,255,255])]:
        maps[name][1828:1924,1776:1872] = colour
    report['flank'] = dict(triangle=ti, old_chart='subpixel isolated UV island', new_chart='48px skin patch, 24px gutter')


def grade_groom(glb, maps):
    # The retained r18 groom occupies x16..352; its fur strip is above v=.63
    # in Blender convention (top of the PNG). Preserve alpha and UV layout.
    A, O, N = [maps['groom_'+s] for s in ('albedo','orm','normal')]
    yy,xx = np.mgrid[0:2048,0:2048]
    strip = (xx>=14)&(xx<354)
    mane = strip & (yy>760)
    grain = .5*np.sin(xx*.19+yy*.013)+.3*np.sin(xx*.63-yy*.009)+.2*np.sin(xx*.043+yy*.025)
    A[mane,:3] = np.clip(np.array([13,15,20])[None,:]*(.95+.075*grain[mane,None]),0,255)
    O[mane,1] = round(255*CONFIG['hair_roughness'])
    O[mane,2] = 0
    N[mane,:2] = np.rint(128+(N[mane,:2].astype(float)-128)*.14)
    N[mane,2] = 255
    fur = strip & (yy<=760)
    # Lower tip/root contrast, irregular longitudinal fibres, no pale borders.
    old = A[fur,:3].astype(float)
    var = .88+.12*np.sin(xx[fur]*.109+1.8*np.sin(yy[fur]*.018))+.055*grain[fur]
    A[fur,:3] = np.clip((old*.62+np.array([65,58,50])*.38)*var[:,None],0,255)
    O[fur,1] = round(255*CONFIG['fur_roughness'])
    O[fur,2] = 0
    N[fur,:2] = np.rint(128+(N[fur,:2].astype(float)-128)*.45)
    N[fur,2] = 255


def grade_fur_trims(glb, pr, regions, maps, report):
    at = pr['attributes']
    P, F, U = glb.acc(at['POSITION']),glb.acc(pr['indices']).reshape(-1,3),glb.acc(at['TEXCOORD_0'])
    A,O,N = [maps['body_'+s] for s in ('albedo','orm','normal')]
    mask = np.zeros((2048,2048),bool)
    count = 0
    for ti,tri in enumerate(F):
        if not np.all(np.isin(regions[tri], ['body','kilt'])):
            continue
        c=P[tri].mean(0)
        if not (.94<c[1]<1.055 or .36<c[1]<.49):
            continue
        uv=U[tri]*2048
        x,y=np.clip(uv.mean(0).astype(int),0,2047)
        col=A[y,x,:3].astype(float)
        if not (col.min()>20 and col.max()-col.min()<48 and col[0]<180 and col[0]/max(col[1],1)<1.5):
            continue
        lo=np.maximum(0,np.floor(uv.min(0)).astype(int)-3)
        hi=np.minimum(2047,np.ceil(uv.max(0)).astype(int)+3)
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        aa,bb,cc=uv
        den=(bb[1]-cc[1])*(aa[0]-cc[0])+(cc[0]-bb[0])*(aa[1]-cc[1])
        if abs(den)<1e-8:
            continue
        wa=((bb[1]-cc[1])*(xx-cc[0])+(cc[0]-bb[0])*(yy-cc[1]))/den
        wb=((cc[1]-aa[1])*(xx-cc[0])+(aa[0]-cc[0])*(yy-cc[1]))/den
        mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1] |= (wa>-.10)&(wb>-.10)&(wa+wb<1.10)
        count+=1
    # Grow into nearby chart padding, but keep the change local.
    for _ in range(3):
        mask |= np.roll(mask,1,0)|np.roll(mask,-1,0)|np.roll(mask,1,1)|np.roll(mask,-1,1)
    yy,xx=np.mgrid[0:2048,0:2048]
    noise=.88+.11*np.sin(xx*.123+np.sin(yy*.041)*2)+.045*np.sin(xx*.47+yy*.073)
    A[mask,:3]=np.clip((A[mask,:3].astype(float)*.70+np.array([61,54,46])*.30)*noise[mask,None],0,255)
    O[mask,1]=240
    O[mask,2]=0
    report['fur_trims']=dict(triangles=count,texels=int(mask.sum()))


def materials(glb, pr, selected, report):
    mats=glb.js['materials']
    mats[0].setdefault('extras',{})['kcaRimScale']=CONFIG['groom_rim']
    mats[0].setdefault('extensions',{})['KHR_materials_specular']={'specularFactor':CONFIG['groom_specular']}
    mats[1].setdefault('extras',{})['kcaRimScale']=CONFIG['body_rim']
    # Cloth is nonmetallic and has no bright grazing reflection on its interior.
    F=glb.acc(pr['indices']).reshape(-1,3)
    P,N=glb.acc(pr['attributes']['POSITION']),glb.acc(pr['attributes']['NORMAL'])
    C=P[F].mean(1)
    radial=C[:,[0,2]]-np.array([0,-.016])
    ndot=(N[F].mean(1)[:,[0,2]]*radial).sum(1)
    cloth=selected & (C[:,1]<.948)
    inner=cloth & (ndot<-.015)
    front=cloth & ~inner
    specs=[('M_brann_kilt_outer',front,1.0),('M_brann_kilt_inner',inner,CONFIG['inner_factor'])]
    out=[]
    base=copy.deepcopy(pr)
    base['indices']=glb.array(pr['indices'],F[~cloth].reshape(-1,1))
    out.append(base)
    for name,sel,factor in specs:
        mat=copy.deepcopy(mats[1])
        mat['name']=name
        mat['extras']['kcaRimScale']=CONFIG['cloth_rim'] if 'outer' in name else 0
        mat.setdefault('extensions',{})['KHR_materials_specular']={'specularFactor':0.0}
        mat['pbrMetallicRoughness'].update(metallicFactor=0,roughnessFactor=1)
        if isinstance(factor,list):
            mat['pbrMetallicRoughness']['baseColorFactor']=factor
        mats.append(mat)
        piece=copy.deepcopy(pr)
        piece.update(material=len(mats)-1,indices=glb.array(pr['indices'],F[sel].reshape(-1,1)))
        out.append(piece)
    glb.js['meshes'][1]['primitives']=out
    used=glb.js.setdefault('extensionsUsed',[])
    if 'KHR_materials_specular' not in used:
        used.append('KHR_materials_specular')
    report['cloth_materials']=dict(outer=int(front.sum()),inner=int(inner.sum()),specular=0,inner_rim=0)


def patch_images(glb, maps, out):
    from lib import pipeline
    for im in glb.js['images']:
        name=im['name']
        path=os.path.join(out,name+'.png')
        # save_png uses Blender's bottom-up image array convention.
        pipeline.save_png(np.flipud(maps[name]).astype(np.float32)/255,path,
                          colorspace='sRGB' if 'albedo' in name else 'Non-Color')
        # Lossless WebP retains every untouched decoded texel and keeps the
        # release small. Argument arrays avoid passing paths through a shell.
        dest=os.path.join(out,name+'.webp')
        node='/home/knotz2/.local/share/fnm/node-versions/v24.21.0/installation/bin/node'
        subprocess.run([node,'--input-type=module','-e',
                        "import sharp from 'sharp';await sharp(process.argv[1]).webp({lossless:true}).toFile(process.argv[2]);",
                        path,dest],cwd=ROOT,check=True)
        im.update(bufferView=glb.blob(open(dest,'rb').read()),mimeType='image/webp')


def compact(glb):
    """Drop superseded donor maps/accessors; retain active buffer bytes exactly."""
    used=set()
    for mesh in glb.js['meshes']:
        for pr in mesh['primitives']:
            used.update(pr['attributes'].values())
            used.add(pr['indices'])
    for sk in glb.js['skins']:
        used.add(sk['inverseBindMatrices'])
    amap={old:new for new,old in enumerate(sorted(used))}
    aa=[copy.deepcopy(glb.js['accessors'][i]) for i in sorted(used)]
    views=set(a['bufferView'] for a in aa)
    views.update(im['bufferView'] for im in glb.js['images'])
    vmap={old:new for new,old in enumerate(sorted(views))}
    buf=bytearray()
    vv=[]
    for i in sorted(views):
        v=copy.deepcopy(glb.js['bufferViews'][i])
        data=glb.buf[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        buf.extend(b'\0'*((-len(buf))%4))
        v['byteOffset']=len(buf)
        buf.extend(data)
        vv.append(v)
    for a in aa:
        a['bufferView']=vmap[a['bufferView']]
    for mesh in glb.js['meshes']:
        for pr in mesh['primitives']:
            pr['attributes']={k:amap[v] for k,v in pr['attributes'].items()}
            pr['indices']=amap[pr['indices']]
    for sk in glb.js['skins']:
        sk['inverseBindMatrices']=amap[sk['inverseBindMatrices']]
    for im in glb.js['images']:
        im['bufferView']=vmap[im['bufferView']]
    glb.js['accessors'],glb.js['bufferViews'],glb.buf=aa,vv,buf


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--base-glb',default=os.path.join(ROOT,'progress/tmp/brann_fix/baseline/hero_brann.glb'))
    ap.add_argument('--base-textures',default=os.path.join(ROOT,'progress/tmp/brann_fix/baseline'))
    ap.add_argument('--out',required=True)
    mode=ap.add_mutually_exclusive_group()
    mode.add_argument('--preview',action='store_true')
    mode.add_argument('--fast',action='store_true')
    mode.add_argument('--release',action='store_true')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    t=time.time()
    assert hashlib.sha256(open(args.base_glb,'rb').read()).hexdigest()==CONFIG['donor_sha']
    out=os.path.abspath(args.out)
    assert not out.startswith(os.path.join(ROOT,'public'))
    os.makedirs(out,exist_ok=True)
    glb=GLB(args.base_glb)
    original=copy.deepcopy(glb.js)
    maps={im['name']:np.fromfile(os.path.join(args.base_textures,im['name']+'.rgba'),np.uint8).reshape(2048,2048,4).copy() for im in glb.js['images']}
    D=team.Donor()
    pr=glb.js['meshes'][1]['primitives'][0]
    P=glb.acc(pr['attributes']['POSITION'])
    F=glb.acc(pr['indices']).reshape(-1,3)
    R=region_vertices(P,D)
    selected=np.all(R[F]=='kilt',axis=1)
    report=dict(donor_sha=CONFIG['donor_sha'],mode='release' if args.release else 'preview',config=CONFIG)
    reweight_kilt(glb,pr,selected,report)
    fix_flank(glb,pr,maps,report)
    grade_groom(glb,maps)
    grade_fur_trims(glb,pr,R,maps,report)
    materials(glb,pr,selected,report)
    log(f'stage part edits done in {time.time()-t:.1f}s')
    patch_images(glb,maps,out)
    # Contract and untouched geometry are guaranteed by leaving those accessors
    # and the skeleton JSON exactly as shipped, then explicitly auditing them.
    for mi,mesh in enumerate(original['meshes']):
        old=mesh['primitives'][0]['attributes']
        for newpr in glb.js['meshes'][mi]['primitives']:
            for key in ('POSITION','NORMAL','TANGENT'):
                assert old[key]==newpr['attributes'][key]
    assert glb.js['nodes']==original['nodes'] and glb.js['skins']==original['skins']
    report['invariants']=dict(position_delta=0,normal_delta=0,tangent_delta=0,rig_identical=True,triangles=54488)
    compact(glb)
    path=os.path.join(out,'hero_brann.glb')
    glb.save(path)
    report.update(sha256=hashlib.sha256(open(path,'rb').read()).hexdigest(),seconds=round(time.time()-t,2))
    json.dump(report,open(os.path.join(out,'build_report.json'),'w'),indent=2)
    log(f'DONE {path} in {report["seconds"]}s')


if __name__=='__main__':
    main()
