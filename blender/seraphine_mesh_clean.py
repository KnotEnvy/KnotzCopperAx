"""Post-export clean of Seraphine's body primitive (Wave C2 r6, iter 13). Pure numpy, no Blender slot.

  ~/kca-assets/venv/bin/python blender/seraphine_mesh_clean.py <in.glb> <out.glb>

Blender's symmetric collapse decimate leaves a few one-triangle "fins" on the mirror plane (x = 0): a triangle whose
third vertex belongs to no other triangle, folded onto a neighbour's edge (that edge is then used 3x; release r6: 5
fins, 10 open edges). The head grid's sealed ear-canal pockets also mesh as two small closed bubbles inside the head.
Both are removed from the INDEX buffer only; every vertex attribute, the rig, materials and textures stay
byte-identical (unused vertices are harmless). Called by build_hero_seraphine.py after export.
"""
import json
import struct
import sys
import pathlib
import numpy as np

TYPES = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
SIZES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
BUBBLE_MAX_VERTS = 80


def clean(src, dst):
    raw = pathlib.Path(src).read_bytes()
    jl = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jl])
    binary = raw[28 + jl:]
    mesh = next(m for m in doc['meshes'] if m['name'] == 'hero_seraphine_mesh')
    pr = mesh['primitives'][0]

    def acc(i):
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        dt = TYPES[a['componentType']]
        n = SIZES[a['type']]
        s = np.dtype(dt).itemsize
        return np.ndarray((a['count'], n), dt, buffer=binary, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          strides=(v.get('byteStride', s * n), s)).copy()
    P = acc(pr['attributes']['POSITION']).astype(float)
    I = acc(pr['indices']).reshape(-1, 3).astype(np.int64)
    _, inv = np.unique(np.round(P, 6), axis=0, return_inverse=True)
    T = inv.ravel()[I]
    keep = np.ones(len(T), bool)
    fins = 0
    for _ in range(4):                       # dangling triangles: a welded vertex used by this triangle only
        use = np.bincount(T[keep].ravel(), minlength=T.max() + 1)
        dang = keep & (use[T] == 1).any(1)
        if not dang.any():
            break
        fins += int(dang.sum())
        keep &= ~dang
    # small closed bubbles inside the head (world: x, -z, y of glTF)
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    Tk = T[keep]
    n = int(T.max()) + 1
    E = np.concatenate([Tk[:, [0, 1]], Tk[:, [1, 2]]])
    _, lab = connected_components(coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n)), directed=False)
    W = np.c_[P[:, 0], -P[:, 2], P[:, 1]]
    Wv = np.zeros((n, 3))
    Wv[inv.ravel()] = W
    bubbles = 0
    tri_lab = lab[Tk[:, 0]]
    kidx = np.flatnonzero(keep)
    for c in np.unique(tri_lab):
        verts = np.unique(Tk[tri_lab == c])
        if len(verts) > BUBBLE_MAX_VERTS:
            continue
        cen = Wv[verts].mean(0)
        if abs(cen[0]) < 0.05 and cen[2] > 1.60 and -0.02 < cen[1] < 0.06:      # inside the skull, behind the eyes
            idx = kidx[tri_lab == c]
            keep[idx] = False
            bubbles += len(idx)
    if fins == 0 and bubbles == 0:
        if src != dst:
            pathlib.Path(dst).write_bytes(raw)
        return {'fins': 0, 'bubbleTriangles': 0}
    newidx = I[keep]
    a = doc['accessors'][pr['indices']]
    out = newidx.astype(TYPES[a['componentType']]).reshape(-1, 1)
    a['count'] = len(out)
    a['byteOffset'] = 0
    replacements = {a['bufferView']: out.tobytes()}
    mesh.setdefault('extras', {})['kcaMeshCleaned'] = {'fins': fins, 'bubbleTriangles': bubbles}
    packed = bytearray()
    for i, v in enumerate(doc['bufferViews']):
        block = replacements.get(i, binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
        packed += b'\0' * ((-len(packed)) % 4)
        v['byteOffset'] = len(packed)
        v['byteLength'] = len(block)
        packed += block
    packed += b'\0' * ((-len(packed)) % 4)
    doc['buffers'][0]['byteLength'] = len(packed)
    jb = json.dumps(doc, separators=(',', ':')).encode()
    jb += b' ' * ((-len(jb)) % 4)
    chunks = struct.pack('<II', len(jb), 0x4e4f534a) + jb + struct.pack('<II', len(packed), 0x004e4942) + packed
    pathlib.Path(dst).write_bytes(b'glTF' + struct.pack('<II', 2, 12 + len(chunks)) + chunks)
    total = sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc['meshes'] for p in m['primitives'])
    return {'fins': fins, 'bubbleTriangles': bubbles, 'bodyTriangles': int(len(newidx)), 'totalTriangles': int(total)}


if __name__ == '__main__':
    print(json.dumps(clean(sys.argv[1], sys.argv[2])))
