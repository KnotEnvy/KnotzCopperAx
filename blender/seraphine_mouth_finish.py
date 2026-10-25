"""Finish Seraphine's small oral cavity without another Blender bake.

Use ~/kca-assets/venv/bin/python (numpy/Pillow). Smooths the lip normal field
continuously, relaxes the baked lip relief, and adds a small
head-bound cavity backstop in the SAME mesh/material. Textures retain the
builder's WebP quality90; no new texture, program, draw or bone is introduced.
Called by build_hero_seraphine.py after export; also accepts an existing release.
"""
import io,json,struct,sys,pathlib
import numpy as np
from PIL import Image,ImageFilter

TYPES={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
SIZES={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def finish(src,dst,texture_dir=None):
    raw=pathlib.Path(src).read_bytes();jl=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+jl]);binary=raw[28+jl:]
    mesh=next(m for m in doc['meshes'] if m['name']=='hero_seraphine_mesh')
    if mesh.get('extras',{}).get('kcaMouthFinished'):
        if src!=dst:pathlib.Path(dst).write_bytes(raw)
        return {'alreadyFinished':True}
    pr=mesh['primitives'][0]
    def acc(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];dt=TYPES[a['componentType']];n=SIZES[a['type']];s=np.dtype(dt).itemsize
        return np.ndarray((a['count'],n),dt,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',s*n),s)).copy()
    attrs={k:acc(i) for k,i in pr['attributes'].items()};P=attrs['POSITION'];N=attrs['NORMAL'];UV=attrs['TEXCOORD_0'];idx=acc(pr['indices']).reshape(-1,3)
    C=P[idx].mean(1);cross=np.cross(P[idx[:,1]]-P[idx[:,0]],P[idx[:,2]]-P[idx[:,0]]);GN=cross/np.maximum(np.linalg.norm(cross,axis=1,keepdims=True),1e-12)
    mouth=(np.abs(C[:,0])<.038)&(C[:,1]>1.568)&(C[:,1]<1.600)&(C[:,2]>.052)
    front=mouth&(GN[:,2]>.15)
    if mouth.sum()<12 or front.sum()<5:raise RuntimeError('Seraphine mouth landmark window no longer matches the mesh')
    appended={k:[] for k in attrs};newidx=idx.copy();count=len(P)
    # Average only outward lip faces, then feather across ALL copies of each
    # position, including UV seams. Splitting individual faces creates hard seams.
    outer=(abs(C[:,0])<.055)&(C[:,1]>1.55)&(C[:,1]<1.615)&(C[:,2]>.069)&(GN[:,2]>.1)
    sums={}
    for i in np.flatnonzero(outer):
        for v in idx[i]:
            key=tuple(np.round(P[v]/1e-6).astype(int))
            sums[key]=sums.get(key,np.zeros(3))+cross[i]
    num=0
    for v in range(len(P)):
        key=tuple(np.round(P[v]/1e-6).astype(int))
        if key not in sums:continue
        fade=np.clip((.015-abs(float(P[v,1])-1.5841))/.008,0,1)*np.clip((.043-abs(float(P[v,0])))/.018,0,1)
        if fade<.001:continue
        nn=sums[key];nn/=max(np.linalg.norm(nn),1e-12)
        nn=N[v]*(1-fade)+nn*fade;nn/=np.linalg.norm(nn)
        old=N[v].copy();axis=np.cross(old,nn);d=old@nn
        # Minimal rotation transports the existing tangent with the normal.
        tt=attrs['TANGENT'][v,:3].copy()
        tt+=np.cross(axis,tt)+np.cross(axis,np.cross(axis,tt))/max(1+d,1e-6)
        tt-=nn*(tt@nn);tt/=np.linalg.norm(tt)
        N[v]=nn;attrs['TANGENT'][v,:3]=tt;num+=1
    images={};views={}
    for im in doc['images']:
        if im['name'] not in ('seraphine_normal','seraphine_orm','seraphine_albedo'):continue
        view=doc['bufferViews'][im['bufferView']];images[im['name']]=Image.open(io.BytesIO(binary[view['byteOffset']:view['byteOffset']+view['byteLength']])).convert('RGB');views[im['name']]=im['bufferView']
    W,H=images['seraphine_normal'].size
    def mask_for(faces):
        result=np.zeros((H,W),np.float32)
        for fi in np.flatnonzero(faces):
            ids=idx[fi];q=UV[ids]*[W,H]
            lo=np.maximum(np.floor(q.min(0)).astype(int),0);hi=np.minimum(np.ceil(q.max(0)).astype(int),[W-1,H-1])
            if np.any(hi<lo):continue
            xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
            (ax,ay),(bx,by),(cx,cy)=q;det=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay)
            if abs(det)<1e-8:continue
            u=((bx-xx)*(cy-yy)-(cx-xx)*(by-yy))/det
            v=((cx-xx)*(ay-yy)-(ax-xx)*(cy-yy))/det;w=1-u-v
            xp=P[ids,0][0]*u+P[ids,0][1]*v+P[ids,0][2]*w
            yp=P[ids,1][0]*u+P[ids,1][1]*v+P[ids,1][2]*w
            fade=np.clip((.012-np.abs(yp-1.5841))/.006,0,1)*np.clip((.038-np.abs(xp))/.012,0,1)
            fade=fade*fade*(3-2*fade);fade=np.where((u>=0)&(v>=0)&(w>=0),fade,0)
            tile=result[lo[1]:hi[1]+1,lo[0]:hi[0]+1];np.maximum(tile,fade,out=tile)
        return np.asarray(Image.fromarray(np.round(result*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))).astype(float)/255
    mm=mask_for(mouth)
    alb=np.asarray(images['seraphine_albedo']).copy();orm=np.asarray(images['seraphine_orm']).copy();nrm=np.asarray(images['seraphine_normal']).copy()
    n=nrm.astype(float)/127.5-1
    n=n*(1-mm[...,None])+np.array([0,0,1])*(mm[...,None])
    n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-12)
    nrm=np.where(mm[...,None]>.001,np.round((n+1)*127.5).clip(0,255).astype(np.uint8),nrm)
    orm[...,1]=np.round(orm[...,1]+mm*np.maximum(220-orm[...,1].astype(float),0)).astype(np.uint8)
    orm[...,2]=np.round(orm[...,2]*(1-mm)).astype(np.uint8)
    # A dark leather texel already in the body atlas is a neutral cavity sample.
    # Keep a complete 5px patch so bilinear filtering cannot sample a neighbouring material.
    good=(alb[...,0]<95)&(alb[...,1]<70)&(alb[...,2]<55)&(orm[...,1]>180)&(orm[...,2]<20)&(nrm[...,2]>230)&(abs(nrm[...,0].astype(float)-128)<20)&(abs(nrm[...,1].astype(float)-128)<20)
    safe=np.asarray(Image.fromarray((good*255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)))>0
    yy,xx=np.nonzero(safe)
    if not len(xx):raise RuntimeError('No stable dark cavity patch in body atlas')
    score=alb[yy,xx].sum(1)+.2*(255-orm[yy,xx,1]);k=int(np.argmin(score));baseuv=np.array([(xx[k]+.5)/W,(yy[k]+.5)/H])
    source=int(np.flatnonzero((np.abs(P[:,0])<.02)&(P[:,1]>1.58)&(P[:,1]<1.59)&(P[:,2]>.07))[0])
    joints=attrs['JOINTS_0'][source];weights=attrs['WEIGHTS_0'][source]
    names=[doc['nodes'][doc['skins'][0]['joints'][int(i)]]['name'] for i,w in zip(joints,weights) if w>.001]
    if names!=['head']:raise RuntimeError('Mouth backstop must be rigidly head-bound')
    center=np.array([0,1.5841,.060]);radii=np.array([.028,.011,.008]);V=[];NN=[];U=[];faces=[]
    V.append(center+np.array([0,radii[1],0]));NN.append(np.array([0,1.,0]));U.append(baseuv)
    for row in range(1,4):
        ph=np.pi*row/4
        for col in range(8):
            th=2*np.pi*col/8;unit=np.array([np.sin(ph)*np.cos(th),np.cos(ph),np.sin(ph)*np.sin(th)])
            V.append(center+radii*unit);nn=unit/radii;NN.append(nn/np.linalg.norm(nn));U.append(baseuv+unit[[0,1]]/np.array([W,H]))
    V.append(center-np.array([0,radii[1],0]));NN.append(np.array([0,-1.,0]));U.append(baseuv)
    for col in range(8):faces.append([0,1+col,1+(col+1)%8])
    for row in range(2):
        for col in range(8):
            a=1+row*8+col;b=1+row*8+(col+1)%8;c=b+8;d=a+8;faces.extend([[a,b,c],[a,c,d]])
    for col in range(8):faces.append([25,17+(col+1)%8,17+col])
    V=np.array(V);NN=np.array(NN);faces=np.array(faces)
    cp=np.cross(V[faces[:,1]]-V[faces[:,0]],V[faces[:,2]]-V[faces[:,0]]);flip=np.sum(cp*NN[faces].mean(1),1)<0;faces[flip]=faces[flip][:,[0,2,1]]
    for co,no,uv in zip(V,NN,U):
        tt=np.cross([0,1,0],no)
        if np.linalg.norm(tt)<1e-6:tt=np.array([1.,0,0])
        tt/=np.linalg.norm(tt)
        for k,a in attrs.items():
            value=co if k=='POSITION' else no if k=='NORMAL' else np.r_[tt,1.] if k=='TANGENT' else uv if k.startswith('TEXCOORD') else a[source].copy()
            appended[k].append(value)
    newidx=np.concatenate([newidx,faces+count])
    replacements={};final_attrs={}
    for k,ai in pr['attributes'].items():
        a=doc['accessors'][ai];out=np.concatenate([attrs[k],np.asarray(appended[k],dtype=attrs[k].dtype)]);a['count']=len(out);a['byteOffset']=0;final_attrs[k]=out
        vi=a['bufferView'];doc['bufferViews'][vi].pop('byteStride',None);replacements[vi]=out.tobytes()
        if 'min' in a:a['min']=out.min(0).tolist();a['max']=out.max(0).tolist()
    ai=pr['indices'];a=doc['accessors'][ai]
    if newidx.max()>np.iinfo(TYPES[a['componentType']]).max:raise RuntimeError('Mouth vertex indices exceed component capacity')
    out=newidx.astype(TYPES[a['componentType']]).reshape(-1,1);a['count']=len(out);a['byteOffset']=0;replacements[a['bufferView']]=out.tobytes()
    checked=newidx[len(idx):]
    vp=final_attrs['POSITION'];vn=final_attrs['NORMAL']
    cp=np.cross(vp[checked[:,1]]-vp[checked[:,0]],vp[checked[:,2]]-vp[checked[:,0]])
    inward=int(np.count_nonzero(np.sum(cp*vn[checked].mean(1),axis=1)<-1e-10))
    if inward:raise RuntimeError(f'Mouth finish produced {inward} inward triangles')
    for name,array in [('seraphine_normal',nrm),('seraphine_orm',orm)]:
        im=Image.fromarray(array);f=io.BytesIO();im.save(f,format='WEBP',quality=90,method=6);replacements[views[name]]=f.getvalue()
        if texture_dir:im.save(pathlib.Path(texture_dir)/(name+'.png'))
    total=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
    if total>30000:raise RuntimeError(f'Mouth finish exceeds 30000 triangle cap: {total}')
    mesh.setdefault('extras',{})['kcaMouthFinished']=1
    packed=bytearray()
    for i,v in enumerate(doc['bufferViews']):
        block=replacements.get(i,binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);packed+=b'\0'*((-len(packed))%4);v['byteOffset']=len(packed);v['byteLength']=len(block);packed+=block
    packed+=b'\0'*((-len(packed))%4);doc['buffers'][0]['byteLength']=len(packed)
    jb=json.dumps(doc,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4);chunks=struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(packed),0x004e4942)+packed
    pathlib.Path(dst).write_bytes(b'glTF'+struct.pack('<II',2,12+len(chunks))+chunks)
    return {'outerLipTriangles':int(front.sum()),'smoothedLipVertices':num,'cavityTrianglesGraded':0,'mouthTexels':int(np.count_nonzero(mm>.01)),'newCavityTriangles':len(faces),'newVertices':sum([len(appended['POSITION'])]),'rigidHead':True,'newInwardTriangles':inward,'totalTriangles':total,'bodyTriangles':len(newidx),'fileMB':pathlib.Path(dst).stat().st_size/1e6}

if __name__=='__main__':
    print(json.dumps(finish(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else None),indent=2))
