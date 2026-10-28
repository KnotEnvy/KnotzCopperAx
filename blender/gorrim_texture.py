"""Gorrim r25 composite atlas transfer. Texture-role owned; donor/part inputs read-only.

pack_sheets is called by the lead's integration builder. All maps are transferred
in display-referred pixel space, with no donor surface chart rotation or scaling.
"""
import os
import time
import json
import numpy as np
import gorrim_team as T

CONFIG = {
    'res': 2048, 'inset': 12, 'dilation': 12, 'chart_guard': 8,
    'body_rim': .3, 'gear_rim': .3, 'groom_rim': .1, 'cutoff': .45,
    'body_normal_strength': .8, 'gear_normal_strength': .85, 'groom_normal_strength': .65,
    'mail_gain': (1.40, 1.36, 1.20), 'mail_roughness': .84, 'mail_metal': .57,
    'mantle_gain': (1.0, .85, .68), 'leather_rgb_gain': (.91, .52, .29),
    'leather_roughness': .88, 'groom_rgb_gain': (1.18, 1.08, .96), 'strand_contrast': 2.8, 'face_density_target': 3.56, 'face_gap': 24,
    'out': os.path.join(T.ROOT, 'progress/tmp/gorrim_team/texture'),
}


def log(s):
    print('[gorrim-texture] '+s, flush=True)


def uv_groups(U):
    """Connected UV corners, independent of glTF normal-seam vertex duplication."""
    p = np.arange(len(U)); seen = {}
    def find(a):
        while p[a] != a:
            p[a] = p[p[a]]; a = p[a]
        return a
    for i, tri in enumerate(np.round(U, 6)):
        for pt in tri:
            key = tuple(pt)
            if key in seen: p[find(i)] = find(seen[key])
            else: seen[key] = i
    groups = {}
    for i in range(len(U)): groups.setdefault(find(i), []).append(i)
    return [np.asarray(v) for v in groups.values()]


def expand_mask(mask, px):
    c=mask.copy()
    for _ in range(px):
        p=np.pad(c,1)
        c=np.logical_or.reduce([p[y:y+mask.shape[0],x:x+mask.shape[1]]for y in range(3)for x in range(3)])
    return c


def chart_pack(U, width=1424, height=2048, bins=None, allow_split=False, grid=4, guard=None):
    """Translation-only polygon nesting on a conservative four-pixel grid.

    Rectangular packing wastes 50% inside long diagonal donor charts. Full UV
    islands stay intact: no cuts/scaling/rotation. Raster masks include 12px
    dilation plus a four-pixel conservative raster footprint.
    """
    guard=CONFIG['chart_guard'] if guard is None else guard
    inset=12;groups=uv_groups(U);boxes=[]
    if allow_split:
        pending=list(groups);groups=[]
        max_wh=np.max([[x1-x0,y1-y0]for x0,y0,x1,y1 in bins],axis=0)-2*inset-grid*2
        while pending:
            ids=pending.pop(0);span=np.ptp(U[ids],axis=(0,1))*2048
            if np.any(span>max_wh) and len(ids)>1:
                axis=int(np.argmax(span/max_wh));centres=U[ids,:,axis].mean(1);mid=(centres.min()+centres.max())*.5
                left=ids[centres<=mid];right=ids[centres>mid]
                if not len(left)or not len(right):raise RuntimeError('unsplittable face chart')
                pending.extend([left,right])
            else:groups.append(ids)
    for ids in groups:
        lo=np.floor(U[ids].min((0,1))*2048/grid).astype(int)*grid
        hi=np.ceil(U[ids].max((0,1))*2048/grid).astype(int)*grid
        boxes.append((ids,lo,np.maximum(hi-lo,grid)))
    bins=bins or [(0,0,width,height)]
    occupancies=[np.zeros(((y1-y0)//grid,(x1-x0)//grid),bool)for x0,y0,x1,y1 in bins];placed=[]
    for ids,lo,wh in sorted(boxes,key=lambda b:(-b[2][1],-b[2][0],int(b[0][0])) if allow_split else (-int(np.prod(b[2])),-len(b[0]),int(b[0][0]))):
        mask=tri_mask(U[ids],lo,wh)
        if not mask.any():mask[wh[1]//2,wh[0]//2]=True
        mask=mask.reshape(wh[1]//grid,grid,wh[0]//grid,grid).any((1,3))
        mask=np.pad(mask,inset//grid);mask=expand_mask(mask,guard//grid)
        mh,mw=mask.shape;choice=None
        for bi,occ in enumerate(occupancies):
            oh,ow=occ.shape
            if mh>oh or mw>ow:continue
            fft_shape=tuple(1<<int(n-1).bit_length()for n in (oh+mh-1,ow+mw-1))
            conv=np.fft.irfft2(np.fft.rfft2(occ.astype(np.float32),s=fft_shape)*np.fft.rfft2(mask[::-1,::-1].astype(np.float32),s=fft_shape),s=fft_shape)
            found=np.argwhere(conv[mh-1:oh,mw-1:ow]<.25)
            if len(found):choice=(bi,*found[0]);break
        if choice is None:raise RuntimeError(f'Translation-only polygon nesting cannot fit island {len(placed)}/{len(boxes)}')
        bi,y,x=choice;occupancies[bi][y:y+mh,x:x+mw]|=mask
        dest=np.array([bins[bi][0]+x*grid+inset,bins[bi][1]+y*grid+inset]);placed.append((ids,lo,wh,dest,inset))
    new=U.copy()
    for ids,lo,wh,dest,inset in placed:new[ids]+=(dest-lo)/2048
    return new,placed,guard*2


def gear_groups(b):
    U=b['UV'];P=b['P'][b['F']]
    e=U[:,1]-U[:,0];f=U[:,2]-U[:,0];sign=np.sign(e[:,0]*f[:,1]-e[:,1]*f[:,0])
    parent=np.arange(len(U));seen={}
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for i in np.flatnonzero(sign):
        for p,u in zip(P[i],U[i]):
            key=(int(sign[i]),*np.round(p*1e6).astype(int),*np.round(u*1e6).astype(int))
            if key in seen:parent[find(i)]=find(seen[key])
            else:seen[key]=i
    groups={}
    for i in np.flatnonzero(sign):groups.setdefault(find(i),[]).append(i)
    return [np.array(ids) for ids in groups.values()],np.flatnonzero(sign==0)


def layout_rects(boxes, width, height, pad=16):
    from collections import deque
    sky=np.zeros(width,np.int32);positions={}
    for i in sorted(range(len(boxes)),key=lambda i:(-boxes[i][1],-boxes[i][0],i)):
        w,h=boxes[i]+pad
        if w>width:return None
        dq=deque();best=None
        for x in range(width):
            while dq and sky[dq[-1]]<=sky[x]:dq.pop()
            dq.append(x)
            while dq and dq[0]<=x-w:dq.popleft()
            if x>=w-1:
                y=int(sky[dq[0]])
                if y+h<=height and (best is None or y<best[0]):best=(y,x-w+1)
        if best is None:return None
        y,x=best;sky[x:x+w]=y+h;positions[i]=np.array([x+pad//2,y+pad//2])
    return positions


def repack_gear(b, maps):
    """Unique gear UV copies inside the SAME authored-size tile; donor density untouched.

    Split projected front/back UV folds before packing. Source part/tile files are
    read-only; only this composite and its object UVs change.
    """
    from lib import pipeline
    groups,zero=gear_groups(b)
    if len(zero):raise RuntimeError('unexpected zero-area gear UVs')
    h,w=maps['albedo'].shape[:2];size=np.array([w,h]);old=b['UV']*size
    bounds=[(np.floor(old[ids].min((0,1))).astype(int),np.ceil(old[ids].max((0,1))).astype(int))for ids in groups]
    for scale in (.55,.50,.45,.40,.35,.30,.25):
        whs=[np.maximum(1,np.ceil((hi-lo)*scale).astype(int))for lo,hi in bounds]
        positions=layout_rects(whs,w,h)
        if positions is not None:break
    else:raise RuntimeError('unique gear charts do not fit')
    result={k:np.empty_like(A)for k,A in maps.items()}
    for k,A in result.items():A[:]=maps[k].mean((0,1))
    new=old.copy()
    for i,ids in enumerate(groups):
        lo,hi=bounds[i];wh=whs[i];dest=positions[i];inset=8
        new[ids]=(old[ids]-lo)*scale+dest
        mask=tri_mask((old[ids]-lo)*scale/2048,np.zeros(2,int),wh)
        if not mask.any():mask[wh[1]//2,wh[0]//2]=True
        cov=np.pad(mask,inset)
        yy,xx=np.mgrid[0:wh[1],0:wh[0]]
        sx=np.clip((xx+.5)/scale+lo[0]-.5,0,w-1.001);sy=np.clip((yy+.5)/scale+lo[1]-.5,0,h-1.001)
        xi=sx.astype(int);yi=sy.astype(int);fx=(sx-xi)[...,None];fy=(sy-yi)[...,None]
        for k,A in maps.items():
            sample=(A[yi,xi]*(1-fx)+A[yi,xi+1]*fx)*(1-fy)+(A[yi+1,xi]*(1-fx)+A[yi+1,xi+1]*fx)*fy
            padded=np.pad(sample,((inset,inset),(inset,inset),(0,0)),mode='edge')
            padded=pipeline.dilate(padded.astype(np.float32),cov,12)
            x,y=dest;ww,hh=wh
            result[k][y-inset:y+hh+inset,x-inset:x+ww+inset]=padded
    return new/size,result,{'unique_charts':len(groups),'chart_scale':scale,'tile_size':[w,h],'gutter_px':16,'source_tile_unchanged':True}


def read_png(path):
    import bpy
    im = bpy.data.images.load(path, check_existing=False)
    # Non-Color gives raw PNG samples; avoids sRGB-linear-sRGB double conversion.
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size; a = np.empty(w*h*4, np.float32); im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def maps_for(prefix):
    return {k: read_png(prefix+'_'+k+'.png') for k in ('albedo', 'orm', 'normal')}


def blank_maps():
    shape = (2048, 2048, 4)
    A = np.ones(shape, np.float32); A[..., :3] = (.10, .075, .05)
    O = np.ones(shape, np.float32); O[..., 1] = .8; O[..., 2] = 0
    N = np.ones(shape, np.float32); N[..., :3] = (.5, .5, 1)
    return dict(albedo=A, orm=O, normal=N)


def tri_mask(U, lo, wh):
    w, h = wh; mask = np.zeros((h, w), bool)
    for tri in U*2048-lo:
        mn = np.maximum(np.floor(tri.min(0)).astype(int), 0)
        mx = np.minimum(np.ceil(tri.max(0)).astype(int), [w-1, h-1])
        if np.any(mx < mn): continue
        xx, yy = np.meshgrid(np.arange(mn[0], mx[0]+1)+.5, np.arange(mn[1], mx[1]+1)+.5)
        (ax, ay), (bx, by), (cx, cy) = tri
        den = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(den) < 1e-12: continue
        a = ((by-cy)*(xx-cx)+(cx-bx)*(yy-cy))/den
        b = ((cy-ay)*(xx-cx)+(ax-cx)*(yy-cy))/den
        mask[mn[1]:mx[1]+1, mn[0]:mx[0]+1] |= (a >= -1e-6)&(b >= -1e-6)&(a+b <= 1+1e-6)
    return mask


def transfer_surface(U, placed, donor, target):
    from lib import pipeline
    for ids, lo, wh, dest, inset in placed:
        w, h = wh; x, y = dest; sx, sy = lo
        mask = tri_mask(U[ids], lo, wh)
        # Subpixel donor charts still need a valid seed sample for filtering.
        if not mask.any(): mask[h//2, w//2] = True
        cov = np.pad(mask, inset)
        for key in target:
            src = donor[key][sy:sy+h, sx:sx+w]
            if src.shape[:2] != (h, w): raise ValueError('donor UV out of bounds')
            a = np.pad(src, ((inset, inset), (inset, inset), (0, 0)), mode='edge')
            a = pipeline.dilate(a, cov, CONFIG['dilation'])
            region=target[key][y-inset:y+h+inset, x-inset:x+w+inset]
            grown=expand_mask(cov,CONFIG['dilation'])
            region[grown]=a[grown]


def paste_tile(target, tile, maps):
    _, x0, y0, x1, y1 = T.CONFIG['tiles'][tile]
    for k in target:
        if maps[k].shape[:2] != (y1-y0, x1-x0): raise ValueError('wrong tile size '+tile)
        target[k][y0:y1, x0:x1] = maps[k]


def read_object(ob, bones):
    from lib import meshutil, skin
    me = ob.data
    if any(len(f.vertices) != 3 for f in me.polygons): raise ValueError('triangle meshes required')
    F = np.array([f.vertices[:] for f in me.polygons], np.int32)
    U = np.empty((len(me.loops), 2), np.float32); me.uv_layers.active.data.foreach_get('uv', U.ravel())
    N = np.array([n.vector[:] for n in me.corner_normals], np.float32).reshape(-1, 3, 3)
    P = meshutil.get_verts(ob, world=True)
    M = np.linalg.inv(np.asarray(ob.matrix_world)[:3, :3]).T
    N = N@M.T
    return dict(P=P, F=F, UV=U.reshape(-1, 3, 2), N=N, W=skin.read_groups(ob, bones))


def join_buffers(chunks, arm, name, bones):
    from lib import meshutil, skin
    P=[];F=[];UV=[];N=[];W=[];offset=0
    for b, ids, uvs in chunks:
        if len(ids)==0: continue
        used=np.unique(b['F'][ids]); remap=np.full(len(b['P']),-1,np.int32);remap[used]=np.arange(len(used))
        P.append(b['P'][used]);F.append(remap[b['F'][ids]]+offset);UV.append(uvs);N.append(b['N'][ids]);W.append(b['W'][used]);offset+=len(used)
    ob=meshutil.mesh_from_numpy(name,np.concatenate(P),tris=np.concatenate(F))
    uv=ob.data.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',np.concatenate(UV).astype(np.float32).ravel())
    ob.data.normals_split_custom_set(np.concatenate(N).reshape(-1,3))
    # Exact weights: do not call top_k(), which drops donor influences below .001.
    skin.write_groups(ob,bones,np.concatenate(W));skin.bind(ob,arm)
    return ob


def density(chunks):
    a3=a2=0.
    for b,ids,U in chunks:
        p=b['P'][b['F'][ids]]; e=p[:,1]-p[:,0];f=p[:,2]-p[:,0]
        a3+=np.linalg.norm(np.cross(e,f),axis=1).sum()*.5
        e=U[:,1]-U[:,0];f=U[:,2]-U[:,0]
        a2+=np.abs(e[:,0]*f[:,1]-e[:,1]*f[:,0]).sum()*.5
    return float(np.sqrt(a2/max(a3,1e-12))*2048)


def restore_export_donor(path, transfer):
    """Lead opt-in after export: preserve exact donor N/TANGENT/JOINTS/WEIGHTS.

    UV translations keep tangent directions valid. Only vertices present in the
    packing correspondence are changed; face edits and authored parts are excluded.
    May run using bundled Python (no bpy required). Never restores old textures/UVs.
    """
    import struct
    def read(p):
        raw=open(p,'rb').read();n=struct.unpack_from('<I',raw,12)[0]
        js=json.loads(raw[20:20+n]);bl=struct.unpack_from('<I',raw,20+n)[0]
        return js,bytearray(raw[28+n:28+n+bl])
    def acc(j,b,i):
        a=j['accessors'][i];v=j['bufferViews'][a['bufferView']]
        dt={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8}[a['componentType']]
        nc={'VEC2':2,'VEC3':3,'VEC4':4,'SCALAR':1}[a['type']]
        off=v.get('byteOffset',0)+a.get('byteOffset',0);size=np.dtype(dt).itemsize*nc
        stride=v.get('byteStride',size)
        return np.ndarray((a['count'],nc),dtype=dt,buffer=b,offset=off,strides=(stride,np.dtype(dt).itemsize)).copy()
    js,buf=read(path);dj,db=read(T.DONOR_GLB);da=dj['meshes'][0]['primitives'][0]['attributes']
    original={k:acc(dj,db,v) for k,v in da.items() if k in ('NORMAL','TANGENT','JOINTS_0','WEIGHTS_0')}
    z=np.load(transfer);P=z['P'];UV=z['UV'];P=np.stack([P[:,0],P[:,2],-P[:,1]],1);UV=np.stack([UV[:,0],1-UV[:,1]],1)
    def keys(P,U):return np.round(np.concatenate([P,U],1)*1e5).astype(np.int64)
    table={}
    for key,vi in zip(keys(P,UV),z['donor_vid']):table.setdefault(tuple(key),set()).add(int(vi))
    donor_names=[dj['nodes'][i]['name'] for i in dj['skins'][0]['joints']]
    dst_names=[js['nodes'][i]['name'] for i in js['skins'][0]['joints']]
    jointmap=np.array([dst_names.index(n) for n in donor_names],np.uint16)
    original['JOINTS_0']=jointmap[original['JOINTS_0']]
    count=0;deltas={}
    for mesh in js['meshes']:
        for pr in mesh['primitives']:
            at=pr['attributes'];p=acc(js,buf,at['POSITION']);u=acc(js,buf,at['TEXCOORD_0']);normal=acc(js,buf,at['NORMAL'])
            matched=[];source=[]
            for vi,key in enumerate(keys(p,u)):
                candidates=table.get(tuple(key))
                if not candidates:continue
                # Coincident hard-edge vertices can share P/UV: use the closest existing normal.
                si=min(candidates,key=lambda k:np.sum((original['NORMAL'][k]-normal[vi])**2))
                matched.append(vi);source.append(si)
            if not matched:continue
            count+=len(matched);mi=np.array(matched);si=np.array(source)
            for key,src in original.items():
                if key not in at:continue
                a=acc(js,buf,at[key]);a[mi]=src[si].astype(a.dtype)
                template=dict(js['accessors'][at[key]]);template.pop('min',None);template.pop('max',None);template.pop('sparse',None)
                buf.extend(b'\0'*((-len(buf))%4));off=len(buf);buf.extend(a.tobytes())
                js['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':a.nbytes,'target':34962})
                template.update(bufferView=len(js['bufferViews'])-1,byteOffset=0)
                js['accessors'].append(template);at[key]=len(js['accessors'])-1
                deltas[key]=max(deltas.get(key,0),float(np.max(np.abs(a[mi].astype(float)-src[si].astype(float)))))
    buf.extend(b'\0'*((-len(buf))%4));js['buffers'][0]['byteLength']=len(buf)
    jb=json.dumps(js,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4)
    raw=struct.pack('<III',0x46546c67,2,28+len(jb)+len(buf))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(buf),0x004e4942)+buf
    with open(path,'wb') as f:f.write(raw)
    return {'restored_exported_vertices':count,'max_donor_attribute_delta':deltas,'uvs_and_maps_unchanged':True}


def grade_donor(D, maps):
    """Frozen donor-region masks, refined by pigment ranges; no source files change."""
    A=maps['albedo']; O=maps['orm'];rgb=A[...,:3];r,g,b=rgb.transpose(2,0,1)
    mantle=tri_mask(D.UV[D.faces('mantle')],np.zeros(2,int),np.array([2048,2048]))
    surface=tri_mask(D.UV[D.faces('body','kilt','mantle')],np.zeros(2,int),np.array([2048,2048]))
    mail=surface&(b>r*.98)&(b>g*.98)&(r>.11)
    green=surface&(g>r*1.12)&(b>r*.8)
    rgb[mail]*=CONFIG['mail_gain'];O[...,1][mail]=CONFIG['mail_roughness'];O[...,2][mail]=CONFIG['mail_metal']
    rgb[mantle]*=np.array(CONFIG['mantle_gain'])
    lum=rgb.mean(2);rgb[green]=lum[green,None]*np.array(CONFIG['leather_rgb_gain']);O[...,1][green]=CONFIG['leather_roughness'];O[...,2][green]=0
    return {'mail_pixels':int(mail.sum()),'mantle_pixels':int(mantle.sum()),'leather_pixels':int(green.sum()),'source_unchanged':True}


def grade_groom(maps, tile):
    """Reinforce the builder's longitudinal pigment grooves, without new noise."""
    A=maps['albedo'];rgb=A[...,:3]
    red=(rgb[...,0]>rgb[...,1]*1.6)&(rgb[...,1]>rgb[...,2]*1.3)
    rgb[red]*=np.array(CONFIG['groom_rgb_gain'])
    if tile=='beard':
        h,w=A.shape[:2];y,x=np.mgrid[0:h,0:w];u=x/w;v=y/h
        phase=u*np.pi*2*82+.75*np.sin(v*6+u*7)+.22*np.sin(v*23+u*17)
        fine=.055*np.sin(phase)+.025*np.sin(phase*2.31)
        broad=.09*np.sin(u*np.pi*2*7+.5*np.sin(v*5));root=.74+.26*np.minimum(1,(1-v)*6)
        old=np.clip(root+fine+broad,.54,1.16)
        new=np.clip(root+fine*CONFIG['strand_contrast']+broad,.46,1.24)
        rgb*= (new/old)[...,None]
    return maps


def sample_chart(A, lo, wh, scale):
    h,w=A.shape[:2];ww,hh=wh
    yy,xx=np.mgrid[0:hh,0:ww]
    sx=np.clip((xx+.5)/scale+lo[0]-.5,0,w-1.001);sy=np.clip((yy+.5)/scale+lo[1]-.5,0,h-1.001)
    xi=sx.astype(int);yi=sy.astype(int);fx=(sx-xi)[...,None];fy=(sy-yi)[...,None]
    return ((A[yi,xi]*(1-fx)+A[yi,xi+1]*fx)*(1-fy)+(A[yi+1,xi]*(1-fx)+A[yi+1,xi+1]*fx)*fy).astype(np.float32)


def pack_face(chunks, maps, body, surface):
    """Uniform face scale into face+reserve bins; no rotation/tangent changes."""
    from lib import pipeline
    old=np.concatenate([u for b,ids,u in chunks]);original=old.copy()
    source_size=np.array(maps['albedo'].shape[1::-1]);groups=uv_groups(old)
    ratio=density([(b,ids,T.tile_to_sheet_uv(u,'face')) for b,ids,u in chunks])/max(density(surface),1e-9)
    scale=max(1.,CONFIG['face_density_target']/ratio)
    pixel=old*source_size
    bins=[T.CONFIG['tiles'][t][1:]for t in ('face','spare')]
    virtual=pixel*scale/2048
    old,placed,gap=chart_pack(virtual,bins=bins,allow_split=True,grid=2,guard=6)
    for ids,lo,wh,dest,inset in placed:
        cov=tri_mask(virtual[ids],lo,wh)
        if not cov.any():cov[wh[1]//2,wh[0]//2]=True
        cov=np.pad(cov,inset);grown=expand_mask(cov,12)
        for key,A in maps.items():
            sample=sample_chart(A,lo/scale,wh,scale)
            sample=np.pad(sample,((inset,inset),(inset,inset),(0,0)),mode='edge')
            sample=pipeline.dilate(sample,cov,12)
            x,y=dest;w,h=wh;region=body[key][y-inset:y+h+inset,x-inset:x+w+inset];region[grown]=sample[grown]
    result=[];offset=0
    for b,ids,u in chunks:
        result.append((b,ids,old[offset:offset+len(ids)]));offset+=len(ids)
    return result,{'source_density_x_body':ratio,'uniform_scale':scale,'density_x_body':ratio*scale,'charts':len(placed),'bins':['face','spare'],'chart_gap_px_2048':gap}


def pack_sheets(D, arm, objs, fast=False, release=False):
    import bpy
    from lib import pipeline
    t0=time.time();mode='release' if release else 'fast'
    # Each assembler invocation owns its map directory, including concurrent lead previews.
    import sys
    cli=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    export_out=cli[cli.index('--out')+1] if '--out' in cli else os.path.join(CONFIG['out'],mode)
    out=os.path.abspath(os.path.join(export_out,'maps'));os.makedirs(out,exist_ok=True)
    sheets={s:blank_maps() for s in ('body','gear','groom')}
    sheets['groom']['albedo'][...,:3]=(.24,.065,.016);sheets['groom']['albedo'][...,3]=0
    chunks={s:[] for s in sheets};face=[];surface=[];donor_chunks=[];active_tiles=set()
    report={'mode':mode,'objects':{},'donor_grade':None}
    donor=maps_for(os.path.join(T.DONOR_DIR,'gorrim'))
    report['donor_grade']=grade_donor(D,donor)
    donor_region_lookup={tuple(np.round(u.mean(0)*1e6).astype(int)):str(r)for u,r in zip(D.UV,D.region)}
    for ob in objs:
        b=read_object(ob,D.bones);U=b['UV'];ids=np.arange(len(U));name=ob.name;report['objects'][name]=len(U)
        if name.startswith('donor_donor'):
            reg=np.array([donor_region_lookup.get(tuple(np.round(u.mean(0)*1e6).astype(int)),'body')for u in U])
            # Per-part fallback may retain Sept beard/brows. Those donor charts
            # belong to the groom sheet, never the retained surface body tile.
            for is_groom in (False,True):
                sel=ids[np.isin(reg,['beard','brows'])==is_groom]
                if not len(sel):continue
                sheet='groom' if is_groom else 'body'
                bins=None
                if is_groom:
                    tile='beard' if np.any(reg[sel]=='beard') else 'brows'
                    bins=[T.CONFIG['tiles'][tile][1:]]
                new,placed,pad=chart_pack(U[sel],bins=bins)
                transfer_surface(U[sel],placed,donor,sheets[sheet])
                chunk=(b,sel,new);chunks[sheet].append(chunk);donor_chunks.append((b,sel,new,U[sel]))
                if not is_groom:
                    surface.append(chunk)
                    report.update(surface_charts=len(placed),chart_gap_px_2048=pad,surface_transfer='integer-pixel translation only; no scaling/rotation',dilation_px_2048=12)
                else:report['retained_donor_groom_tris']=len(sel)
        else:
            tile=next((k for k in T.CONFIG['tiles'] if name.startswith('donor_'+k) or any(m and m.name.split('.')[0] in ('M_hero_gorrim_'+k,'M_hero_gorrim_'+k+'_mask')for m in ob.data.materials)),None)
            if tile is None:raise ValueError('cannot identify tile '+name)
            active_tiles.add(tile)
            if tile=='face':face.append((b,ids,U));continue
            sheet=T.CONFIG['tiles'][tile][0];chunks[sheet].append((b,ids,T.tile_to_sheet_uv(U,tile)))
    for tile in sorted(active_tiles-{'face'}):
        role=T.TILE_OWNER[tile];prefix=os.path.join(T.PARTS_DIR,role,'tiles',tile);m=maps_for(prefix)
        if T.CONFIG['tiles'][tile][0]=='groom':
            if tile in ('beard','brows'):m=grade_groom(m,tile)
            alpha=m['albedo'][...,3].copy();mask=alpha>CONFIG['cutoff']
            # RGB dilation underneath alpha-zero samples prevents pale mip fringes.
            m['albedo']=pipeline.dilate(m['albedo'],mask,12);m['albedo'][...,3]=alpha
        paste_tile(sheets[T.CONFIG['tiles'][tile][0]],tile,m)
    if face:
        face,report['face_repack']=pack_face(face,maps_for(os.path.join(T.PARTS_DIR,'face','tiles','face')),sheets['body'],surface)
        chunks['body'].extend(face)
    report['face_density_x_body']=density(face)/max(density(surface),1e-9) if face else None
    lookup={}
    for vi,uv in enumerate(np.round(D.UVv*1e5).astype(np.int64)):lookup.setdefault(tuple(uv),[]).append(vi)
    targetP=[];targetU=[];sourceI=[]
    for b,ids,new,old in donor_chunks:
        P=b['P'][b['F'][ids]].reshape(-1,3);indices=[]
        for pt,uv in zip(P,np.round(old.reshape(-1,2)*1e5).astype(np.int64)):
            candidates=lookup.get(tuple(uv),[])
            if not candidates:raise RuntimeError('retained donor UV lookup failed')
            indices.append(min(candidates,key=lambda i:np.sum((D.P[i]-pt)**2)))
        targetP.append(P);targetU.append(new.reshape(-1,2));sourceI.extend(indices)
    np.savez_compressed(os.path.join(out,'donor_uv_transfer.npz'),P=np.concatenate(targetP),UV=np.concatenate(targetU),donor_vid=np.array(sourceI,np.int32))
    report['donor_uv_transfer']=os.path.join(out,'donor_uv_transfer.npz')
    final=[];specs={};report['sheets']={}
    for sheet,maps in sheets.items():
        if not chunks[sheet]:continue
        if sheet!='groom':maps['albedo'][...,3]=1
        ims={}
        for key,A in maps.items():
            if fast and not release:A=A.reshape(1024,2,1024,2,4).mean((1,3))
            path=os.path.join(out,f'{sheet}_{key}.png')
            pipeline.save_png(A,path,colorspace='sRGB' if key=='albedo' else 'Non-Color')
            ims[key]=bpy.data.images.load(path,check_existing=False);ims[key].colorspace_settings.name='sRGB' if key=='albedo' else 'Non-Color'
        mat=pipeline.final_material(T.CONFIG['sheets'][sheet]['material']+'_packed',ims['albedo'],ims['normal'],ims['orm'])
        for n in mat.node_tree.nodes:
            if n.type=='NORMAL_MAP':n.inputs['Strength'].default_value=CONFIG[sheet+'_normal_strength']
        if sheet=='groom':
            bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');ta=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==ims['albedo'])
            mat.node_tree.links.new(ta.outputs['Alpha'],bs.inputs['Alpha']);mat.surface_render_method='DITHERED'
        mat['kcaRimScale']=CONFIG[sheet+'_rim'];specs[mat.name]={'rim':CONFIG[sheet+'_rim'],'alpha':'MASK' if sheet=='groom' else None,'cutoff':CONFIG['cutoff']}
        ob=join_buffers(chunks[sheet],arm,'hero_gorrim_'+sheet,D.bones);ob.data.materials.append(mat);final.append(ob)
        report['sheets'][sheet]={'size':list(ims['albedo'].size),'maps':[os.path.join(out,f'{sheet}_{k}.png')for k in maps]}
    for ob in objs:bpy.data.objects.remove(ob,do_unlink=True)
    report['seconds']=round(time.time()-t0,2);report['materials']=specs;T.save_json(os.path.join(out,'pack_report.json'),report)
    log(f'stage pack_sheets done in {time.time()-t0:.1f}s')
    return {'objects':final,'materials':specs,'report':report}
