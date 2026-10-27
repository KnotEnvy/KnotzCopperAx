"""Brann r19 composite atlas transfer. Texture-role owned; donor/part inputs read-only.

pack_sheets is called by the lead's integration builder. All maps are transferred
in display-referred pixel space, with no donor surface chart rotation or scaling.
"""
import os
import time
import json
import numpy as np
import brann_team as T

CONFIG = {
    'res': 2048, 'inset': 6, 'dilation': 12,
    'body_rim': .5, 'groom_rim': .14, 'cutoff': .48,
    'body_normal_strength': .68, 'groom_normal_strength': .45,
    'pelt_rgb': (.430, .405, .355), 'pelt_variation': .035,
    'pelt_roughness': .88,
    'out': os.path.join(T.ROOT, 'progress/tmp/brann_team/texture'),
}


def log(s):
    print('[brann-texture] '+s, flush=True)


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


def chart_pack(U, width=1424, height=2048):
    """Integer translations only. Skyline boxes include their own six-pixel inset."""
    groups = uv_groups(U)
    boxes = []
    for ids in groups:
        lo = np.floor(U[ids].min((0, 1))*2048).astype(int)
        hi = np.ceil(U[ids].max((0, 1))*2048).astype(int)
        boxes.append((ids, lo, np.maximum(hi-lo, 1)))
    for pad in (24, 20, 16, 12):
        sky = np.zeros(width, np.int32); placed = []; okay = True
        for ids, lo, wh in sorted(boxes, key=lambda b: (-b[2][1], -b[2][0], int(b[0][0]))):
            w, h = wh + pad
            if w > width: okay = False; break
            # Sliding-window maximum supplies the lowest legal skyline placement.
            from collections import deque
            dq = deque(); best = None
            for x in range(width):
                while dq and sky[dq[-1]] <= sky[x]: dq.pop()
                dq.append(x)
                while dq and dq[0] <= x-w: dq.popleft()
                if x >= w-1:
                    y = int(sky[dq[0]])
                    if y+h <= height and (best is None or y < best[0]): best = (y, x-w+1)
            if best is None: okay = False; break
            y, x = best; sky[x:x+w] = y+h
            inset = pad//2
            placed.append((ids, lo, wh, np.array([x+inset, y+inset]), inset))
        if okay:
            new = U.copy()
            for ids, lo, wh, dest, inset in placed: new[ids] += (dest-lo)/2048
            return new, placed, pad
    raise RuntimeError('Translation-only surface charts cannot fit: lead cleanup must remove donor debris first')


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
            target[key][y-inset:y+h+inset, x-inset:x+w+inset] = a
    target['albedo'][..., 3] = 1


def grade_pelt(maps):
    """Replace swirled support with broken directional fibres; tint every alpha edge."""
    A, O, N = (maps[k] for k in ('albedo', 'orm', 'normal'))
    h, w = A.shape[:2]; v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    u /= w-1; v /= h-1
    # Calm, low contrast wolf coat. Authored all the way under transparent texels.
    grain = (.45*np.sin(u*417+v*5)+.25*np.sin(u*941-v*11)+.30*np.sin(u*41+v*9))
    t=np.clip((v-.365)/.58,0,1)
    lane=np.clip(np.floor((u-.025)/.178),0,4);side=np.clip((u-(.025+lane*.178))/.148,0,1)
    shade = .62+.62*t + CONFIG['pelt_variation']*grain
    shade *= .90+.10*np.sin(np.pi*side)
    support=v<.30
    # Broken, straight down-flow groups over the continuous cap, without swirl normals.
    ridge=(.5+.5*np.sin(u*81+v*12+.8*np.sin(u*17)))**4
    support_shade=.70+.45*ridge+.025*grain
    shade[support]=support_shade[support]
    A[..., :3] = np.array(CONFIG['pelt_rgb'])*shade[..., None]
    O[..., 0] = .94; O[..., 1] = CONFIG['pelt_roughness']; O[..., 2] = 0
    N[..., 0] = .5+.009*np.cos(u*417+v*5)
    N[..., 1] = .5+.003*np.sin(u*131+v*11); N[..., 2] = 1
    return maps


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


def pack_sheets(D, arm, objs, fast=False, release=False):
    import bpy
    from lib import pipeline
    t0=time.time();mode='release' if release else 'fast';out=os.path.join(CONFIG['out'],mode);os.makedirs(out,exist_ok=True)
    tile_overrides={}
    body=blank_maps();groom=blank_maps();groom['albedo'][...,:3]=(.025,.027,.030)
    donor=maps_for(os.path.join(T.DONOR_DIR,'brann'))
    body_chunks=[];groom_chunks=[];face_chunks=[];surface_chunks=[];donor_chunks=[];report={'mode':mode,'ao_grounding':False,'objects':{}}
    # Donor grooming strip is retained at its original resolution; unused hair-role tiles are NEVER loaded.
    gx0,gx1=1712,2048
    for key in groom: groom[key][:,16:16+gx1-gx0]=donor[key][:,gx0:gx1]
    groom['albedo'][...,3]=1
    for ob in objs:
        b=read_object(ob, D.bones);U=b['UV'];allids=np.arange(len(U));name=ob.name
        report['objects'][name]=len(U)
        if name.startswith('donor_donor'):
            groom_mask=U[...,0].min(1)>.83
            ids=allids[groom_mask];new=U[ids].copy();new[...,0]+=(16-gx0)/2048
            if len(ids):
                groom_chunks.append((b,ids,new));donor_chunks.append((b,ids,new,U[ids]))
            ids=allids[~groom_mask]
            new,placed,pad=chart_pack(U[ids]);transfer_surface(U[ids],placed,donor,body)
            chunk=(b,ids,new);body_chunks.append(chunk);surface_chunks.append(chunk);donor_chunks.append((b,ids,new,U[ids]))
            report.update(surface_charts=len(placed),chart_gap_px_2048=pad,surface_transfer='integer-pixel translation only; no scaling/rotation',dilation_px_2048=12)
        else:
            tile=next((k for k in T.CONFIG['tiles'] if name.startswith('donor_'+k) or any(m and m.name.split('.')[0] in ('M_hero_brann_'+k, 'M_hero_brann_'+k+'_mask') for m in ob.data.materials)),None)
            if tile is None: raise ValueError('cannot identify local tile: '+name)
            if tile=='gear':
                U,tile_overrides[tile],report['gear_unique_uv']=repack_gear(b,maps_for(os.path.join(T.PARTS_DIR,'gear','tiles','gear')))
            sheet=T.CONFIG['tiles'][tile][0];chunk=(b,allids,T.tile_to_sheet_uv(U,tile))
            (groom_chunks if sheet=='groom' else body_chunks).append(chunk)
            if tile=='face':face_chunks.append(chunk)
    for tile,role in [('face','face'),('gear','gear'),('pelt','gear'),('furtrim','gear'),('spare','face')]:
        prefix=os.path.join(T.PARTS_DIR,role,'tiles',tile)
        if not os.path.exists(prefix+'_albedo.png'):continue
        m=tile_overrides.get(tile) or maps_for(prefix)
        if tile=='pelt':m=grade_pelt(m)
        paste_tile(groom if T.CONFIG['tiles'][tile][0]=='groom' else body,tile,m)
    body['albedo'][...,3]=1
    # Mapping survives atlas translations and lets the lead restore exact donor glTF attributes after export.
    lookup={}
    for vi,uv in enumerate(np.round(D.UVv*1e5).astype(np.int64)):lookup.setdefault(tuple(uv),[]).append(vi)
    targetP=[];targetU=[];sourceI=[]
    for b,ids,new,old in donor_chunks:
        P=b['P'][b['F'][ids]].reshape(-1,3);indices=[]
        for pt,uv in zip(P,np.round(old.reshape(-1,2)*1e5).astype(np.int64)):
            candidates=lookup.get(tuple(uv),[])
            if not candidates:candidates=[int(np.argmin(np.sum((D.UVv-uv/1e5)**2,axis=1)))]
            ix=min(candidates,key=lambda i:np.sum((D.P[i]-pt)**2));indices.append(ix)
        targetP.append(P);targetU.append(new.reshape(-1,2));sourceI.extend(indices)
    np.savez_compressed(os.path.join(out,'donor_uv_transfer.npz'),P=np.concatenate(targetP),UV=np.concatenate(targetU),donor_vid=np.array(sourceI,np.int32))
    report['donor_uv_transfer']=os.path.join(out,'donor_uv_transfer.npz')
    report['face_density_x_body']=density(face_chunks)/max(density(surface_chunks),1e-9) if face_chunks else None
    log(f'stage transfer done in {time.time()-t0:.1f}s')
    final=[];specs={};report['sheets']={}
    for sheet,maps,chunks,name in [('body',body,body_chunks,'hero_brann_mesh'),('groom',groom,groom_chunks,'hero_brann_groom')]:
        ims={}
        for key,A in maps.items():
            # Average the 2x2 source footprint for --fast (alpha included).
            if fast and not release:A=A.reshape(1024,2,1024,2,4).mean((1,3))
            path=os.path.join(out,f'{sheet}_{key}.png')
            pipeline.save_png(A,path,colorspace='sRGB' if key=='albedo' else 'Non-Color')
            ims[key]=bpy.data.images.load(path,check_existing=False);ims[key].colorspace_settings.name='sRGB' if key=='albedo' else 'Non-Color'
        mat=pipeline.final_material(T.CONFIG['sheets'][sheet]['material']+'_packed',ims['albedo'],ims['normal'],ims['orm'])
        for n in mat.node_tree.nodes:
            if n.type=='NORMAL_MAP':n.inputs['Strength'].default_value=CONFIG[sheet+'_normal_strength']
        if sheet=='groom':
            bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            ta=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==ims['albedo'])
            mat.node_tree.links.new(ta.outputs['Alpha'],bs.inputs['Alpha'])
            mat.surface_render_method='DITHERED'
        mat['kcaRimScale']=CONFIG[sheet+'_rim']
        specs[mat.name]={'rim':CONFIG[sheet+'_rim'],'alpha':'MASK' if sheet=='groom' else None,'cutoff':CONFIG['cutoff']}
        ob=join_buffers(chunks,arm,name,D.bones);ob.data.materials.append(mat);final.append(ob)
        report['sheets'][sheet]={'size':list(ims['albedo'].size),'maps':[os.path.join(out,f'{sheet}_{k}.png') for k in maps]}
    for ob in objs:bpy.data.objects.remove(ob,do_unlink=True)
    report['seconds']=round(time.time()-t0,2);report['materials']=specs
    T.save_json(os.path.join(out,'pack_report.json'),report)
    log(f'stage pack_sheets done in {time.time()-t0:.1f}s')
    return {'objects':final,'materials':specs,'report':report}


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
