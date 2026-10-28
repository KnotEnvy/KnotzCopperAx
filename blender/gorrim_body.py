"""Gorrim r25 BODY: deterministic socket hands and fitted lower gear.
Run only through tools/blender-run.mjs. Imports shared interface, never edits it.
Kilt repair is weight-only and opt-in: apply_kilt_weights(D), patch_export_kilt(path).
"""
import argparse,json,math,os,struct,sys,time,zlib
import numpy as np
import bpy,bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
import gorrim_team as T
from lib import pipeline
CONFIG={"seed":2528,"out":os.path.join(T.PARTS_DIR,"body"),"scratch":os.path.join(T.TEAM,"body"),
 "uv_margin":10,"haft_r":.0215,"finger_gap":.0018,"disc_diameter":.120,
 "fit":.0012,"leather_depth":.004,"tasset_hem":.437,"kilt_chain_share":.08,"kilt_thigh_share":.85,"kilt_fall_height":.16,
 "palette":{"skin":((168,100,70),.69,0),"nail":((177,127,100),.61,0),
 "leather":((64,37,23),.84,0),"edge":((83,49,26),.77,0),
 "brass":((201,148,57),.40,.82),"fur":((107,89,70),.94,0)}}
MAT_NAMES=list(CONFIG['palette'])
HAND_FRAMES={}
DISC_CENTRES=[]
REPORT={}
def log(s):
    print("[gorrim-body] " + s, flush=True)


def norm(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def basis(n):
    n = norm(n)
    u = norm(np.cross(n, (0, 0, 1)))
    if np.linalg.norm(u) < .1:
        u = np.array((1., 0., 0.))
    return u, norm(np.cross(n, u))


def joint(arm, name):
    return np.array(arm.matrix_world @ arm.data.bones[name].head_local)


def mesh(name, P, F, mat, bevel=0, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(P).tolist(), [], F)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(bpy.data.materials["body_" + mat])
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        b = ob.modifiers.new("Crafted edge bevel", "BEVEL")
        b.width, b.segments, b.limit_method = bevel, 1, "ANGLE"
        b.angle_limit = math.radians(38)
        b.miter_outer, b.harden_normals, b.use_clamp_overlap = "MITER_ARC", True, True
    w = ob.modifiers.new("Weighted hard surface normals", "WEIGHTED_NORMAL")
    w.keep_sharp = True
    return ob


def grid(name, P, mat, wrap=False, caps=False, bevel=0):
    P = np.asarray(P)
    nr, nc = P.shape[:2]
    F = []
    for i in range(nr - 1):
        for j in range(nc if wrap else nc - 1):
            k = (j + 1) % nc
            a, b, c, d = i * nc + j, i * nc + k, (i + 1) * nc + k, (i + 1) * nc + j
            F.append((a, b, c, d))
    if caps:
        F += [tuple(range(nc - 1, -1, -1)), tuple((nr - 1) * nc + j for j in range(nc))]
    return mesh(name, P.reshape(-1, 3), F, mat, bevel)


def ball(name, c, r, mat="brass", flatten=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=3, radius=r, location=c)
    ob = bpy.context.object
    ob.name = name
    if flatten is not None:
        n, depth = flatten
        n = norm(n)
        for v in ob.data.vertices:
            q = np.array(v.co)
            v.co = q + n * np.dot(q, n) * (depth - 1)
    ob.data.materials.append(bpy.data.materials["body_" + mat])
    for f in ob.data.polygons:
        f.use_smooth = True
    return ob


def tube(name, path, radii, mat, sides=12, caps=True):
    path = np.asarray(path)
    radii = np.broadcast_to(radii, (len(path),))
    P = []
    old_u = None
    closed = np.linalg.norm(path[0] - path[-1]) < 1e-7
    first_frame = None
    for i, c in enumerate(path):
        tangent = norm(path[1] - path[-2]) if closed and i in (0, len(path) - 1) else \
                  norm(path[min(len(path) - 1, i + 1)] - path[max(0, i - 1)])
        u, v = basis(tangent)
        if old_u is not None:
            u = norm(old_u - tangent * np.dot(old_u, tangent))
            v = norm(np.cross(tangent, u))
        if first_frame is None:
            first_frame = (u.copy(), v.copy())
        if closed and i == len(path) - 1:
            u, v = first_frame
        old_u = u
        P.append([c + radii[i] * (u * math.cos(a) + v * math.sin(a))
                  for a in np.linspace(0, 2 * math.pi, sides, endpoint=False)])
    return grid(name, P, mat, wrap=True, caps=caps and not closed)


def ribbon(name, path, normals, width, depth, mat, bevel=.0007):
    path, normals = np.asarray(path), np.asarray(normals)
    P = []
    for i, p in enumerate(path):
        tangent = norm(path[min(i + 1, len(path) - 1)] - path[max(0, i - 1)])
        n = norm(normals[i])
        side = norm(np.cross(tangent, n))
        P.append([p + side * w * width / 2 + n * h for w, h in
                  [(-1, 0), (-1, depth), (1, depth), (1, 0)]])
    return grid(name, P, mat, wrap=True, caps=True, bevel=bevel)


class Surface:
    def __init__(self, D, regions=("body", "mantle")):
        self.bvh = BVHTree.FromPolygons([Vector(p) for p in D.P], D.F[D.faces(*regions)].tolist(), all_triangles=True)

    def ray(self, p, d, offset=0):
        h, n, _, _ = self.bvh.ray_cast(Vector(p), Vector(d), 3)
        if h is None:
            raise RuntimeError("surface ray missed: " + str((np.asarray(p).tolist(), np.asarray(d).tolist())))
        return np.array(h) + np.array(n) * offset, np.array(n)

    def torso(self, x, z, front=True, offset=0):
        return self.ray((x, -.8 if front else .8, z), (0, 1 if front else -1, 0), offset)


def join_and_unwrap(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        for mod in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = "body_" + name
    # Unwrap each connected curved patch with angle-limited projections; preserve
    # physical relative scale when packing, with twelve pixels of tile padding.
    pipeline.smart_project_faces(ob, np.ones(len(ob.data.polygons), bool), angle=55)
    pipeline.pack_atlas_skyline([ob], margin_px=CONFIG["uv_margin"], res=1024)
    tri = ob.modifiers.new("Export triangles", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri.name)
    ob.data.update()
    return ob


def arrays(ob):
    me = ob.data
    me.calc_loop_triangles()
    P = np.array([v.co[:] for v in me.vertices], float)
    F = np.array([list(p.vertices) for p in me.polygons], np.int32)
    UV = np.array([x.uv[:] for x in me.uv_layers.active.data]).reshape(-1, 3, 2)
    N = np.array([n.vector[:] for n in me.corner_normals]).reshape(-1, 3, 3)
    length=np.linalg.norm(N,axis=2)
    flat=np.cross(P[F[:,1]]-P[F[:,0]],P[F[:,2]]-P[F[:,0]])
    flat/=np.maximum(np.linalg.norm(flat,axis=1,keepdims=True),1e-12)
    N=np.where((length<1e-8)[:,:,None],flat[:,None,:],N)
    N /= np.maximum(np.linalg.norm(N, axis=2, keepdims=True), 1e-12)
    mats = [s.name.removeprefix("body_") for s in me.materials]
    tags = np.array([MAT_NAMES.index(mats[p.material_index]) for p in me.polygons])
    return P, F, UV, N, tags


def clean_arrays(P, F, UV, N, tags):
    area = .5 * np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    pos_id = np.unique(np.round(P, 7), axis=0, return_inverse=True)[1].ravel()
    _, first = np.unique(np.sort(pos_id[F], axis=1), axis=0, return_index=True)
    keep = np.zeros(len(F), bool)
    keep[first] = True
    keep &= area >= T.CONFIG["cleanup"]["degenerate_area"]
    return P, F[keep], UV[keep], N[keep], tags[keep]


def png(path, data):
    arr = np.clip(np.round(data * 255), 0, 255).astype(np.uint8)[::-1]
    h, w, c = arr.shape
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\0" + r.tobytes() for r in arr)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2 if c == 3 else 6, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def restore_preview_donor(path):
    """Opt-in workaround for the shared export's normal/weight round trip.

    Source data comes from original GLB accessors, not Blender's armature groups.
    P+UV identify donor corners; joint indices are remapped by exact bone names.
    """
    ct = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    def read(p):
        raw = bytearray(open(p, "rb").read())
        n = struct.unpack_from("<I", raw, 12)[0]
        g = json.loads(raw[20:20 + n])
        start = 28 + n
        def acc(i):
            a = g["accessors"][i]
            b = g["bufferViews"][a["bufferView"]]
            dt, count = ct[a["componentType"]], nc[a["type"]]
            offset = start + b.get("byteOffset", 0) + a.get("byteOffset", 0)
            stride = b.get("byteStride", np.dtype(dt).itemsize * count)
            return np.ndarray((a["count"], count), dtype=dt, buffer=raw, offset=offset,
                              strides=(stride, np.dtype(dt).itemsize))
        return raw, g, acc
    source, donor, source_acc = read(T.DONOR_GLB)
    raw, g, acc = read(path)
    da = donor["meshes"][0]["primitives"][0]["attributes"]
    oldbones = [donor["nodes"][j]["name"] for j in donor["skins"][0]["joints"]]
    bones = [g["nodes"][j]["name"] for j in g["skins"][0]["joints"]]
    lookup = {}
    for i, k in enumerate(np.round(np.c_[source_acc(da["POSITION"]), source_acc(da["TEXCOORD_0"])], 6)):
        lookup.setdefault(tuple(k), []).append(i)
    done = 0
    for me in g["meshes"]:
        for pr in me["primitives"]:
            if g["materials"][pr.get("material", 0)]["name"] != "M_hero_gorrim":
                continue
            at = pr["attributes"]
            outN = acc(at["NORMAL"])
            idx = []
            for i, k in enumerate(np.round(np.c_[acc(at["POSITION"]), acc(at["TEXCOORD_0"])], 6)):
                candidates = lookup.get(tuple(k))
                if not candidates:
                    raise RuntimeError("unmatched retained donor vertex " + str(k))
                idx.append(min(candidates, key=lambda j: np.linalg.norm(source_acc(da["NORMAL"])[j] - outN[i])))
            idx = np.array(idx, int)
            for key in ("NORMAL", "TANGENT", "JOINTS_0", "WEIGHTS_0"):
                if key not in at or key not in da:
                    continue
                values = source_acc(da[key])[idx].copy()
                if key == "JOINTS_0":
                    values = np.array([bones.index(oldbones[j]) for j in values.ravel()]).reshape(values.shape)
                acc(at[key])[:] = values
            done += len(idx)
    with open(path, "wb") as f:
        f.write(raw)
    report = {"restored_donor_vertices": done, "attributes": ["NORMAL", "TANGENT", "JOINTS_0", "WEIGHTS_0"],
              "method": "P+UV identity, named joint remap; original donor accessor values restored after Blender export"}
    T.save_json(os.path.join(os.path.dirname(path), "restored_donor.json"), report)
    return report



def init_materials():
    for name,(rgb,rough,metal) in CONFIG['palette'].items():
        m=bpy.data.materials.new('body_'+name)
        m.diffuse_color=tuple(v/255 for v in rgb)+(1,)


def ellipsoid(name,c,axes,frame,mat='skin',segments=16,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1)
    ob=bpy.context.object;ob.name=name
    for v in ob.data.vertices:v.co=np.asarray(c)+np.asarray(frame)@(np.array(v.co)*np.asarray(axes))
    ob.data.materials.append(bpy.data.materials['body_'+mat])
    for f in ob.data.polygons:f.use_smooth=True
    return ob


def make_bvh(D,regions,mask=None):
    ids=D.faces(*regions)
    if mask is not None:ids=ids[mask(D.C[ids])]
    return BVHTree.FromPolygons([Vector(p) for p in D.P],D.F[ids].tolist(),all_triangles=True)


def radial_hit(bvh,a,z,centre=(0,-.020)):
    d=np.array([math.sin(a),-math.cos(a),0.])
    origin=np.array([centre[0],centre[1],z])+d*.8
    hit,n,fi,dist=bvh.ray_cast(Vector(origin),Vector(-d),1.2)
    if hit is None:raise RuntimeError(f'fit ray misses angle={a} z={z}')
    n=np.array(n);p=np.array(hit)
    if n@d<0:n=-n
    return p,n


def build_hands(D,arm):
    objects=[];report={}
    for side in ['L','R']:
        bone=arm.data.bones['hand_'+side];sock=arm.data.bones['socket_hand_'+side]
        w=np.array(bone.head_local);h=norm(np.array(bone.tail_local)-w)
        g=np.array(sock.head_local);t=norm(np.array(sock.tail_local)-g)
        n=norm(g-w-h*((g-w)@h));frame=np.stack([h,t,n],1)
        HAND_FRAMES[side]=(w,h,t,n,g)
        objects.append(ellipsoid('palm_'+side,g-n*.050-h*.020,(.046,.054,.023),frame))
        wristpath=np.array([w-h*.066,w-h*.025,w+h*.015,g-n*.051-h*.023])
        objects.append(tube('buried_wrist_'+side,wristpath,[.041,.039,.037,.033],'skin',sides=14))
        # Four distinct, thick fingers. The inner rail follows the haft at 1.8mm.
        clear=[]
        for j,(axial,r) in enumerate(zip([-.043,-.015,.014,.041],[.0115,.013,.0128,.0105])):
            angles=np.linspace(-math.pi*.54,math.pi*.99,12)
            f=np.linspace(0,1,len(angles))
            profile=1.02-.37*f+.16*np.exp(-((f-.26)/.09)**2)+.12*np.exp(-((f-.58)/.08)**2)
            radii=r*profile
            path=np.array([g+t*axial+(h*math.cos(a)+n*math.sin(a))*(CONFIG['haft_r']+CONFIG['finger_gap']+rad) for a,rad in zip(angles,radii)])
            finger=tube('finger_'+side+str(j),path,radii,'skin',sides=10)
            # Keep the entire inner rail outside the haft as phalanges taper.
            for vert in finger.data.vertices:
                q=np.array(vert.co)-g;radial=q-t*(q@t);dist=np.linalg.norm(radial)
                if dist<CONFIG['haft_r']+CONFIG['finger_gap']:
                    vert.co=np.array(vert.co)+radial/max(dist,1e-12)*(CONFIG['haft_r']+CONFIG['finger_gap']-dist)
            objects.append(finger)
            objects.append(ellipsoid('finger_tip_'+side+str(j),path[-1],(radii[-1],radii[-1],radii[-1]),np.eye(3),segments=10,rings=6))
            a=angles[-2];nc=path[-2]+(h*math.cos(a)+n*math.sin(a))*(radii[-2]*.88)
            objects.append(ellipsoid('nail_'+side+str(j),nc,(radii[-2]*.70,radii[-2]*.68,.0015),np.stack([t,n*math.cos(a)-h*math.sin(a),h*math.cos(a)+n*math.sin(a)],1),'nail',10,5))
            p=np.array([v.co[:] for v in finger.data.vertices]);q=p-g;dist=np.linalg.norm(q-np.outer(q@t,t),axis=1)-CONFIG['haft_r']
            clear.extend((dist.reshape(len(path),10).min(1)*1000).tolist())
        # Opposing thumb crosses the index finger and grows from the thenar pad.
        tr=.014;aa=np.linspace(-math.pi*.60,math.pi*.18,10)
        tp=np.array([g+t*(.055-.025*i/(len(aa)-1))+(h*math.cos(a)+n*math.sin(a))*(CONFIG['haft_r']+.002+tr) for i,a in enumerate(aa)])
        objects.append(tube('thumb_'+side,tp,tr,'skin',sides=12))
        objects.append(ellipsoid('thumb_tip_'+side,tp[-1],(tr,tr,tr),np.eye(3),segments=12,rings=6))
        a=aa[-2];objects.append(ellipsoid('thumb_nail_'+side,tp[-2]+(h*math.cos(a)+n*math.sin(a))*.012,(.010,.012,.002),np.stack([t,n*math.cos(a)-h*math.sin(a),h*math.cos(a)+n*math.sin(a)],1),'nail',10,5))
        report[side]={'finger_inner_clearance_mm':[min(clear),max(clear)],'wrist_burial_target_mm':18,'fingers':4,'thumbs':1,'socket':g.tolist()}
    REPORT['hands']=report
    return objects


def fitted_band(name,bvh,angles,zrows,mat='leather',centre=(0,-.020),depth=None):
    depth=CONFIG['leather_depth'] if depth is None else depth
    outside=[];inside=[];normals=[]
    for z in zrows:
        o=[];inn=[];ns=[]
        for a in angles:
            p,n=radial_hit(bvh,a,z,centre)
            inn.append(p+n*CONFIG['fit']);o.append(p+n*(CONFIG['fit']+depth));ns.append(n)
        outside.append(o);inside.append(inn);normals.append(ns)
    out=np.array(outside);inn=np.array(inside)
    closed=abs(abs(angles[-1]-angles[0])-2*math.pi)<1e-5
    if closed:out[:,-1]=out[:,0];inn[:,-1]=inn[:,0]
    nr,nc=out.shape[:2]
    P=np.concatenate([out.reshape(-1,3),inn.reshape(-1,3)])
    F=[];off=nr*nc
    for i in range(nr-1):
        for j in range(nc-1):
            a=i*nc+j;b=a+1;c=a+nc+1;d=a+nc
            F.extend([(a,b,c,d),(off+d,off+c,off+b,off+a)])
    for row in [0,nr-1]:
        for j in range(nc-1):
            a=row*nc+j;b=a+1;F.append((a,a+off,b+off,b))
    for col in ([0,nc-1] if not closed else []):
        for i in range(nr-1):
            a=i*nc+col;b=a+nc;F.append((a,b,b+off,a+off))
    return mesh(name,P,F,mat),out,np.array(normals)


def disc(name,c,n,r,mat='brass'):
    u,v=basis(n);P=[];F=[];N=24 if r>.04 else 16
    for z,rad in [(-.004,r*.96),(0,r),(.005,r*.96)]:
        P.extend([c+n*z+rad*(u*math.cos(a)+v*math.sin(a)) for a in np.linspace(0,2*math.pi,N,endpoint=False)])
    for k in range(2):
        for j in range(N):F.append((k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j))
    F.extend([tuple(range(N-1,-1,-1)),tuple(2*N+j for j in range(N))])
    objects=[mesh(name,P,F,mat)]
    path=[c+n*.006+r*.84*(u*math.cos(a)+v*math.sin(a)) for a in np.linspace(0,2*math.pi,N+1)]
    objects.append(tube(name+'_raised_rim',path,.003,'brass',sides=6,caps=False))
    DISC_CENTRES.append((np.array(c)+n*.005,np.array(n),r,u,v))
    return objects


def build_belt(D):
    bvh=make_bvh(D,['body','kilt'],lambda P:(np.abs(P[:,0])<.36)&(P[:,2]>.64)&(P[:,2]<.76))
    # On the original belt, with both edges crossing it so no floating overlay.
    ob,outer,ns=fitted_band('wide_waist_belt',bvh,np.linspace(0,2*math.pi,45),[.677,.698,.721],depth=.004)
    objects=[ob]
    p,n=radial_hit(bvh,0,.700);objects+=disc('knotwork_buckle',p+n*.007,n,CONFIG['disc_diameter']/2)
    for a in np.linspace(0,2*math.pi,23,endpoint=False)[1:]:
        p,n=radial_hit(bvh,a,.701);objects.append(ball('belt_stud',p+n*.005,.0055,flatten=(n,.5)))
    REPORT['belt']={'disc_mm':120,'inner_offset_mm':[1.2,1.2],'outer_offset_mm':[5.2,5.2]}
    return objects


def build_tassets(D):
    bvh=make_bvh(D,['kilt']);objects=[]
    for j,centre in enumerate([-1.28,-.64,0,.64,1.28]):
        angles=np.linspace(centre-.205,centre+.205,5)
        ob,outer,ns=fitted_band('leather_tasset_'+str(j),bvh,angles,np.linspace(.687,CONFIG['tasset_hem']+.008*(j%2),5),depth=.004)
        objects.append(ob)
        # Edge studs penetrate their leather, all under the same chain weights.
        for row,col in [(1,0),(2,0),(3,0),(1,4),(2,4),(3,4),(4,2)]:
            objects.append(ball('panel_edge_stud',outer[row,col],.004,flatten=(ns[row,col],.55)))
    REPORT['tassets']={'panels':5,'hem_m':CONFIG['tasset_hem'],'above_skirt_hem_mm':(CONFIG['tasset_hem']-.363914)*1000,'inner_offset_mm':1.2}
    return objects


def build_boots(D,arm):
    objects=[];rng=np.random.default_rng(CONFIG['seed']);tuft_sizes=[]
    for side,sgn in [('L',1),('R',-1)]:
        ankle=np.array(arm.data.bones['foot_'+side].head_local);centre=(float(ankle[0]),float(ankle[1]))
        bvh=make_bvh(D,['body'],lambda P:(P[:,0]*sgn>0)&(P[:,2]<.33))
        for direction in [-1,1]:
            # Paired crossing, helical leather wraps around the existing shafts.
            P=[];Ns=[]
            for f in np.linspace(0,1,39):
                a=direction*(f*math.pi*3.7)+.2
                z=.098+f*.166
                row=[];nr=[]
                for dz in [-.008,.008]:
                    p,n=radial_hit(bvh,a,z+dz,centre);row.append(p+n*(.0012+(.0006 if direction<0 else 0)));nr.append(n)
                P.append(row);Ns.append(nr)
            P=np.array(P);Ns=np.array(Ns);out=P+Ns*.004
            nr,nc=P.shape[:2];V=np.concatenate([out.reshape(-1,3),P.reshape(-1,3)]);off=nr*nc;F=[]
            for i in range(nr-1):
                a=i*2;b=a+1;c=a+3;d=a+2
                F.extend([(a,b,c,d),(off+d,off+c,off+b,off+a),(a,d,d+off,a+off),(b,b+off,c+off,c)])
            F.extend([(0,off,off+1,1),(off-2,off-1,2*off-1,2*off-2)])
            objects.append(mesh('cross_wrap_'+side+str(direction),V,F,'leather'))
        # Short overlapping lens shells; broad, rounded, tapered and lying down.
        for j,a in enumerate(np.linspace(0,2*math.pi,20,endpoint=False)):
            size=float(rng.uniform(.023,.043));tuft_sizes.append(size)
            p,n=radial_hit(bvh,a,.295,centre)
            down=np.array([0.,0.,-1.]);tang=norm(np.cross(n,down));path=[p-n*.003]
            for f in [.25,.7,1.]:
                hit,normal=radial_hit(bvh,a,.295-size*f,centre);path.append(hit+normal*.002)
            widths=[size*.43,size*.60,size*.37,size*.035];V=[]
            for c,w in zip(path,widths):V.extend([c-tang*w,c+n*.004,c+tang*w,c-n*.003])
            F=[(3,2,1,0)]
            for k in range(3):
                for q in range(4):F.append((k*4+q,k*4+(q+1)%4,(k+1)*4+(q+1)%4,(k+1)*4+q))
            F.append((12,13,14,15));objects.append(mesh('lying_fur_'+side+str(j),V,F,'fur'))
        p,n=radial_hit(bvh,sgn*math.pi/2,.241,centre);objects+=disc('outer_boot_disc_'+side,p+n*.008,n,.022)
    REPORT['boots']={'wrap_inner_offset_mm':1.2,'tufts':len(tuft_sizes),'tuft_length_mm':[min(tuft_sizes)*1000,max(tuft_sizes)*1000],'variation_ratio':max(tuft_sizes)/min(tuft_sizes)}
    return objects


def kilt_weights(P,bones):
    """Continuous angular/height field, bounded chain contribution and no level switches.

    Hips retain the waistband. Lower skirt follows the thighs smoothly with a small
    neighbour-chain response. Only kilt vertices use this field; source data is untouched.
    """
    P=np.asarray(P);W=np.zeros((len(P),len(bones)))
    z=P[:,2];fall=np.clip((.704-z)/CONFIG['kilt_fall_height'],0,1);fall=fall*fall*(3-2*fall)
    theta=np.arctan2(P[:,0],-(P[:,1]+.020)/.70)
    angular=np.maximum(np.stack([np.cos(theta-a) for a in [0,math.pi/2,math.pi,-math.pi/2]],1),0)
    angular/=np.maximum(angular.sum(1,keepdims=True),1e-9)
    ch=CONFIG['kilt_chain_share']*fall
    for j,s in enumerate(['F','L','B','R']):W[:,bones.index('kilt_'+s+'_1')]=ch*angular[:,j]
    th=CONFIG['kilt_thigh_share']*fall
    left=.5+.5*np.tanh(P[:,0]/.075)
    W[:,bones.index('thigh_L')]=th*left;W[:,bones.index('thigh_R')]=th*(1-left)
    W[:,bones.index('hips')]=1-ch-th
    # Same top-four limit as release, explicit here so engine sees the tested field.
    order=np.argsort(W,axis=1)[:,:-4];np.put_along_axis(W,order,0,axis=1)
    return W/np.maximum(W.sum(1,keepdims=True),1e-12)


def apply_kilt_weights(D):
    ids=np.unique(D.F[D.faces('kilt')]);W=kilt_weights(D.P[ids],D.bones)
    D.Wn[ids]=W
    out=os.path.join(CONFIG['out'],'weights');os.makedirs(out,exist_ok=True)
    np.savez_compressed(os.path.join(out,'kilt.npz'),donor_vertex=ids,P=D.P[ids],W=W,bones=np.array(D.bones))
    T.save_json(os.path.join(out,'kilt.json'),{'donor_sha':T.DONOR_SHA,'vertices':len(ids),'triangles':2400,'geometry_uv_normals_changed':False,'chain_share':CONFIG['kilt_chain_share'],'thigh_share':CONFIG['kilt_thigh_share'],'integration':'gorrim_body.patch_export_kilt(path) after exact donor attribute restoration; POSITION lookup works after UV packing'})
    return ids,W


def patch_export_kilt(path):
    """POSITION-only weight patch supports preview or a repacked integrated export."""
    from gorrim_team import _bt
    raw=bytearray(open(path,'rb').read());n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n]);start=28+n
    ct={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8};nc={'VEC2':2,'VEC3':3,'VEC4':4,'SCALAR':1}
    def acc(i):
        a=g['accessors'][i];b=g['bufferViews'][a['bufferView']];dt=ct[a['componentType']];c=nc[a['type']]
        return np.ndarray((a['count'],c),dtype=dt,buffer=raw,offset=start+b.get('byteOffset',0)+a.get('byteOffset',0),strides=(b.get('byteStride',np.dtype(dt).itemsize*c),np.dtype(dt).itemsize))
    D=T.Donor();ids,W=apply_kilt_weights(D)
    lookup={tuple(k):j for j,k in enumerate(np.rint(D.P[ids]*1e6).astype(np.int64))};bones=[g['nodes'][j]['name'] for j in g['skins'][0]['joints']];done=0
    for me in g['meshes']:
        for pr in me['primitives']:
            at=pr['attributes'];pg=acc(at['POSITION']);pb=np.stack([pg[:,0],-pg[:,2],pg[:,1]],1).astype(np.float64)
            for i,p in enumerate(np.rint(pb*1e6).astype(np.int64)):
                j=lookup.get(tuple(p))
                if j is None:continue
                inds=np.argsort(W[j])[-4:][::-1];acc(at['JOINTS_0'])[i]=[bones.index(D.bones[k]) for k in inds];acc(at['WEIGHTS_0'])[i]=W[j,inds];done+=1
    assert done > 0, 'no donor kilt vertices matched'
    stale=[]
    for me in g['meshes']:
        for pr in me['primitives']:
            at=pr['attributes'];joint=acc(at['JOINTS_0']);weight=acc(at['WEIGHTS_0'])
            for j,name in enumerate(bones):
                if name.startswith('kilt_') and name.endswith(('_2','_3')):
                    count=int(((joint==j)&(weight>1e-6)).sum())
                    if count:stale.append((name,count))
    assert not stale, ('unpatched old kilt influences',stale)
    open(path,'wb').write(raw)
    rep={'vertices_patched':done,'method':'position-only exact donor kilt mask; named joint remapping','chain_share':CONFIG['kilt_chain_share'],'thigh_share':CONFIG['kilt_thigh_share']}
    T.save_json(os.path.join(os.path.dirname(path),'kilt_patch.json'),rep)
    return rep


def weights_for(name,P,D):
    if name=='tassets':
        allowed=['hips','thigh_L','thigh_R']+[b for b in D.bones if b.startswith('kilt_')]
        W,_=T.transfer_weights(P,D,regions=('kilt',),bones=allowed)
        return W
    if name=='belt':
        W,_=T.transfer_weights(P,D,regions=('body',),bones=['hips','spine'])
        return W
    W=np.zeros((len(P),len(D.bones)))
    for side,sgn in [('L',1),('R',-1)]:
        s=P[:,0]*sgn>0
        if name=='hands':
            w,h,t,n,g=HAND_FRAMES[side];blend=np.clip(((P[s]-w)@h+.050)/.04,0,1)
            W[s,D.bones.index('hand_'+side)]=blend;W[s,D.bones.index('forearm_'+side)]=1-blend
        else:
            foot=np.clip((.125-P[s,2])/.06,0,1)*.6
            W[s,D.bones.index('shin_'+side)]=1-foot;W[s,D.bones.index('foot_'+side)]=foot
    return W


def shade(P,tag):
    name=MAT_NAMES[tag];rgb,rough,metal=CONFIG['palette'][name];x,y,z=P.T
    noise=np.sin(x*1733+y*1277+z*1891)*np.sin(x*671-y*1531+z*887)
    val=.97+.025*np.sin(x*93+z*47)+.018*noise;H=noise*.000025
    if name in ['leather','edge']:H+=noise*.000065;val*=.98+.035*np.sin(z*110+x*71)
    if name=='fur':
        strands=np.sin(x*1281+y*997+.8*np.sin(z*103));val*=.94+.10*strands;H+=strands*.00012
    if name=='skin':
        val*=1+.025*np.sin(z*157+x*49)
        # Faint transverse joint folds follow each curled finger, with worn warm skin.
        for side,(w,h,t,n,g) in HAND_FRAMES.items():
            local=P-g;ang=np.arctan2(local@n,local@h);axial=local@t
            near=(P[:,0]*(1 if side=='L' else -1)>0)&(np.abs(axial)<.056)
            radius=np.linalg.norm(local-np.outer(axial,t),axis=1)
            folds=np.maximum.reduce([np.exp(-((ang-a)/.055)**2) for a in [-.20*math.pi,.35*math.pi,.77*math.pi]])
            folds*=near&(radius>.030)&(radius<.068)
            val*=1-.075*folds;H-=folds*.00016
    if name=='brass':
        for c,n,r,u,v in DISC_CENTRES:
            q=P-c;X=q@u/r;Y=q@v/r;d=q@n;R=np.sqrt(X*X+Y*Y);A=np.arctan2(Y,X)
            m=(R<.79)&(abs(d)<.009)
            knot=np.maximum(np.exp(-((R-(.48+.17*np.cos(3*A)))/.048)**2),np.exp(-((R-(.48-.17*np.cos(3*A)))/.048)**2))
            val[m]*=.62+.50*knot[m];H[m]+=knot[m]*.0007
    A=np.clip(np.array(rgb)[None]/255*val[:,None],0,1);O=np.tile((.98,rough,metal),(len(P),1));return A,O,H

def paint_tile(tile, P, F, UV, tags):
    res = np.array([576,768]) if tile == "hands" else np.array([1024,1024])
    A = np.zeros((res[1], res[0], 3), np.float32)
    O = np.zeros_like(A)
    H = np.zeros((res[1], res[0]), np.float32)
    mask = np.zeros((res[1], res[0]), bool)
    densities = []
    for fi, (f, U) in enumerate(zip(F, UV)):
        uv = U * res
        low = np.maximum(np.floor(uv.min(0)).astype(int), 0)
        high = np.minimum(np.ceil(uv.max(0)).astype(int), res - 1)
        if (high < low).any():
            continue
        yy, xx = np.mgrid[low[1]:high[1] + 1, low[0]:high[0] + 1]
        q = np.stack([xx + .5, yy + .5], -1).reshape(-1, 2)
        a, b, c = uv
        det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(det) < 1e-10:
            continue
        w1 = ((q[:, 0] - a[0]) * (c[1] - a[1]) - (q[:, 1] - a[1]) * (c[0] - a[0])) / det
        w2 = ((b[0] - a[0]) * (q[:, 1] - a[1]) - (b[1] - a[1]) * (q[:, 0] - a[0])) / det
        bc = np.stack([1 - w1 - w2, w1, w2], 1)
        inside = (bc >= -1e-6).all(1)
        if not inside.any():
            continue
        world = bc[inside] @ P[f]
        aa, oo, hh = shade(world, int(tags[fi]))
        iy, ix = yy.ravel()[inside], xx.ravel()[inside]
        A[iy, ix], O[iy, ix], H[iy, ix], mask[iy, ix] = aa, oo, hh, True
        a3 = np.linalg.norm(np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]]))
        densities.append(math.sqrt(abs(det) / max(a3, 1e-12)))
    original = mask.copy()
    # Propagate colour/ORM/height sixteen pixels under empty texels; never dark rims.
    for _ in range(16):
        old = mask.copy()
        for axis, step in ((0, 1), (1, 1), (0, -1), (1, -1)):
            source = np.roll(old, step, axis)
            take = ~mask & source
            for arr in (A, O, H):
                arr[take] = np.roll(arr, step, axis)[take]
            mask[take] = True
    dy, dx = np.gradient(H)
    td = float(np.median(densities))
    V = np.stack([-dx * td, -dy * td, np.ones_like(dx)], -1)
    V /= np.linalg.norm(V, axis=2, keepdims=True)
    N = V * .5 + .5
    A[~mask] = np.array(CONFIG["palette"]["leather"][0]) / 255
    O[~mask] = (1, .8, 0)
    N[~mask] = (.5, .5, 1)
    out = os.path.join(CONFIG["out"], "tiles")
    os.makedirs(out, exist_ok=True)
    for k, arr in (("albedo", A), ("orm", O), ("normal", N)):
        png(os.path.join(out, tile + "_" + k + ".png"), arr)
    return {"coverage": float(original.mean()), "median_texels_per_m": td, "dilation_px": 16}



def save_group(parts,D,tile):
    objects=[];bounds={}
    for name,obs in parts.items():
        for ob in obs:bounds[ob.name]=name
        objects+=obs
    # One shared unwrap for every part on lower: overlap-free across all gear.
    # Record object membership as an integer attribute before joining.
    names=list(parts)
    for name,obs in parts.items():
        for ob in obs:
            attr=ob.data.attributes.new('body_part','INT','FACE')
            for item in attr.data:item.value=names.index(name)
    ob=join_and_unwrap(objects,'_'.join(names));P,F,UV,N,tags=arrays(ob)
    attr=np.array([v.value for v in ob.data.attributes['body_part'].data])
    P,F,UV,N,both=clean_arrays(P,F,UV,N,np.c_[tags,attr]);tags=both[:,0];attr=both[:,1]
    tex=paint_tile(tile,P,F,UV,tags)
    for i,name in enumerate(names):
        sel=attr==i;faces=F[sel];used=np.unique(faces);remap=np.full(len(P),-1);remap[used]=np.arange(len(used));W=weights_for(name,P[used],D)
        rep=dict(REPORT[name],tris=int(sel.sum()),texture=tex)
        assert sel.sum()<=T.CONFIG['budget'][name],(name,sel.sum())
        T.save_part(CONFIG['out'],name,P=P[used],F=remap[faces],UV=UV[sel],N=N[sel],W=W,bones=D.bones,tile=tile,meta={'role':'body','replaces':['hand_L','hand_R'] if name=='hands' else [],'notes':rep})
        REPORT[name]=rep;log(f'stage {name} done: {sel.sum()} tris')
    bpy.data.objects.remove(ob,do_unlink=True)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true');ap.add_argument('--iter',type=int,default=1);ap.add_argument('--only',choices=['hands','lower','all'],default='all');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    t=time.time();os.makedirs(CONFIG['scratch'],exist_ok=True);D=T.Donor();arm=T.import_armature(T.DONOR_GLB);init_materials();apply_kilt_weights(D)
    # Match the original hands' albedo from their owned donor charts.
    im=bpy.data.images.load(os.path.join(T.DONOR_DIR,'gorrim_albedo.webp'));pixels=np.array(im.pixels[:]).reshape(im.size[1],im.size[0],4)
    uv=D.UVv[np.unique(D.F[D.faces('hand_L','hand_R')])];rgb=pixels[np.clip((uv[:,1]*im.size[1]).astype(int),0,im.size[1]-1),np.clip((uv[:,0]*im.size[0]).astype(int),0,im.size[0]-1),:3];col=np.median(rgb[(rgb.max(1)>.2)],0)
    CONFIG['palette']['skin']=(tuple((col*255).tolist()),.69,0)
    if a.only in ['hands','all']:save_group({'hands':build_hands(D,arm)},D,'hands')
    if a.only in ['lower','all']:save_group({'belt':build_belt(D),'tassets':build_tassets(D),'boots':build_boots(D,arm)},D,'lower')
    apply_kilt_weights(D);T.save_json(os.path.join(CONFIG['scratch'],'form.json'),REPORT)
    log('stage parts done '+str(round(time.time()-t,2))+'s')
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    if a.preview:
        import build_hero_gorrim_team as B
        old=sys.argv;out=os.path.join(CONFIG['scratch'],'preview',str(a.iter));sys.argv=[old[0],'--','--preview-role','body','--out',out]
        try:B.main()
        finally:sys.argv=old
        path=os.path.join(out,'hero_gorrim.glb');restore_preview_donor(path);log('kilt repair '+json.dumps(patch_export_kilt(path)))
    log('DONE '+str(round(time.time()-t,2))+'s')
if __name__=='__main__':main()
