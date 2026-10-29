"""Stage5 r32 private GLB utilities and connected stone forms; no donor builder import."""
import copy
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np


class Glb:
    """Lossless accessor reads and append-only mesh replacement.

    Donor nodes, meshes outside the allowlist, accessors, and the whole original
    binary buffer survive unchanged. Re-exporting the donor through Blender would
    otherwise change split normals, COLOR_0 precision and triangle ordering.
    """
    def __init__(self, path):
        self.path = Path(path)
        self.raw = self.path.read_bytes()
        magic, version, size = struct.unpack_from('<4sII', self.raw)
        assert (magic, version, size) == (b'glTF', 2, len(self.raw))
        n, tag = struct.unpack_from('<I4s', self.raw, 12)
        assert tag == b'JSON'
        self.doc = json.loads(self.raw[20:20 + n])
        nb, tag = struct.unpack_from('<I4s', self.raw, 20 + n)
        assert tag == b'BIN\0'
        self.binary = self.raw[28 + n:28 + n + nb]

    def accessor(self, index):
        a = self.doc['accessors'][index]
        v = self.doc['bufferViews'][a['bufferView']]
        types = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
        widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
        dt, nc = np.dtype(types[a['componentType']]), widths[a['type']]
        offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        data = np.ndarray((a['count'], nc), dt, self.binary, offset,
                          strides=(v.get('byteStride', dt.itemsize * nc), dt.itemsize)).copy()
        if a.get('normalized'):
            data = data.astype(np.float64) / np.iinfo(dt).max
            if dt.kind == 'i':
                data = np.maximum(data, -1)
        return data

    def mesh(self, name):
        node = next(n for n in self.doc['nodes'] if n.get('name') == name)
        p, = self.doc['meshes'][node['mesh']]['primitives']
        assert p.get('mode', 4) == 4
        attrs = {k: self.accessor(a) for k, a in p['attributes'].items()}
        return attrs, self.accessor(p['indices']).reshape(-1, 3).astype(np.int32)

    def write(self, path, doc=None, binary=None):
        doc = self.doc if doc is None else doc
        binary = self.binary if binary is None else binary
        raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=True).encode()
        raw += b' ' * (-len(raw) % 4)
        binary += b'\0' * (-len(binary) % 4)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(raw) + len(binary)) +
                               struct.pack('<I4s', len(raw), b'JSON') + raw +
                               struct.pack('<I4s', len(binary), b'BIN\0') + binary)

    def isolate(self, name, path):
        doc = copy.deepcopy(self.doc)
        node = copy.deepcopy(next(n for n in doc['nodes'] if n.get('name') == name))
        assert not node.get('children')
        doc['nodes'], doc['scenes'], doc['scene'] = [node], [{'nodes': [0]}], 0
        self.write(path, doc)

    def replace(self, replacements, path):
        assert set(replacements) == {'pillar', 'pillar_lo', 'throne'}
        doc, binary = copy.deepcopy(self.doc), bytearray(self.binary)

        def append(data, typ, component, bounds=False):
            data = np.ascontiguousarray(data)
            binary.extend(b'\0' * (-len(binary) % 4))
            vi = len(doc['bufferViews'])
            doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': data.nbytes})
            binary.extend(data.tobytes())
            a = {'bufferView': vi, 'componentType': component, 'count': len(data), 'type': typ}
            if bounds:
                a.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
            ai = len(doc['accessors'])
            doc['accessors'].append(a)
            return ai

        for name, (attrs, tris) in replacements.items():
            node = next(n for n in doc['nodes'] if n['name'] == name)
            prim = {'attributes': {}, 'mode': 4}
            for semantic in ('POSITION', 'NORMAL', 'COLOR_0'):
                data = np.asarray(attrs[semantic], dtype='<f4')
                assert np.isfinite(data).all()
                prim['attributes'][semantic] = append(data, 'VEC4' if semantic == 'COLOR_0' else 'VEC3',
                                                     5126, bounds=semantic == 'POSITION')
            prim['indices'] = append(np.asarray(tris, dtype='<u4').reshape(-1), 'SCALAR', 5125)
            doc['meshes'][node['mesh']]['primitives'] = [prim]
        doc['buffers'][0]['byteLength'] = len(binary)
        self.write(path, doc, bytes(binary))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def subset(attrs, tris, face_mask):
    faces = tris[face_mask]
    used, inverse = np.unique(faces, return_inverse=True)
    return {k: v[used].copy() for k, v in attrs.items()}, inverse.reshape(-1, 3).astype(np.int32)


def concatenate(parts):
    keys = ('POSITION', 'NORMAL', 'COLOR_0')
    attrs = {k: np.concatenate([p[0][k] for p in parts]).astype(np.float32) for k in keys}
    tris, offset = [], 0
    for a, t in parts:
        tris.append(t + offset)
        offset += len(a['POSITION'])
    return attrs, np.concatenate(tris).astype(np.int32)


def connected_face_groups(attrs, tris):
    """Weld normal/color seams for selection, without modifying donor payloads."""
    _, welded = np.unique(np.round(attrs['POSITION'], 7), axis=0, return_inverse=True)
    parent = list(range(int(welded.max()) + 1))
    def find(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v
    for a, b, c in welded[tris]:
        root = find(int(a))
        parent[find(int(b))] = root
        parent[find(int(c))] = root
    groups = {}
    for fi, vi in enumerate(welded[tris[:, 0]]):
        groups.setdefault(find(int(vi)), []).append(fi)
    return [np.array(ids, np.int32) for ids in groups.values()]


def add_cobra_face(S, center, scale, cfg, eyes=True):
    """Shaped brow, broad muzzle, carved mouth; all eyes/fangs root in the same surface."""
    from lib.sdf import V, Ellipsoid, Capsule, RoundCone
    c = np.array(center)
    def p(x, y, z):
        return c + np.array((x, y, z)) * scale
    S.add(Ellipsoid(p(0, 0, 0), V(.27, .34, .18) * scale), .065 * scale, 'stone')
    S.add(Ellipsoid(p(0, -.28, -.025), V(.23, .20, .12) * scale), .055 * scale, 'stone')
    S.sub(Ellipsoid(p(0, -.40, -.105), V(.175, .19, .055) * scale), .018 * scale)
    S.add(Ellipsoid(p(0, -.29, -.17), V(.18, .20, .075) * scale), .04 * scale, 'stone')
    for side in (-1, 1):
        S.add(Capsule(p(side * .22, .02, .13), p(side * .17, -.31, .105), .065 * scale),
              .035 * scale, 'stone')
        # Eye bulges sit inside the cheeks. Colour, not detached eyeball geometry, supplies glow.
        if eyes:
            S.add(Ellipsoid(p(side * .225, -.155, .065), V(.052, .066, .045) * scale),
                  .025 * scale, 'stone')
        S.add(RoundCone(p(side * .13, -.43, -.085), p(side * .125, -.44, -.205),
                        .028 * scale, .012 * scale), .018 * scale, 'stone')
        S.sub(Ellipsoid(p(side * .095, -.445, .055), V(.032, .044, .023) * scale), .012 * scale)


def pillar_sculpt(cfg):
    from lib.sdf import Sculpt, V, Ellipsoid, Chain, Displace, Capsule
    c = cfg['pillar']
    S = Sculpt(materials=('stone',), default_mat='stone')
    points, radii = [], []
    for t in np.linspace(0, 1, c['samples']):
        a = c['end_angle'] - (1 - t) * c['turns'] * math.tau
        r = c['tail_radius'] + (c['coil_radius'] - c['tail_radius']) * t ** .38
        rr = c['path_radius'] - .11 * (1 - t)
        points.append(V(math.cos(a) * rr, math.sin(a) * rr, c['bottom'] + t * c['rise']))
        radii.append(r)
    points += [V(.08, -1.29, 4.00), V(0, -1.57, 4.31), V(0, -1.80, 4.61)]
    radii += [.43, .38, .31]
    # Broad planes stay quiet. No tiled scale field or high-frequency displacement.
    S.add(Displace(Chain(points, radii, k=.065), c['wear_depth'], c['wear_frequency'],
                   octaves=1, seed=cfg['seed']), .045, 'stone')
    # A flared fan, a thick shoulder root and a shallow concha, all fused to the neck.
    S.add(Ellipsoid(V(0, -1.85, 4.57), V(c['hood_width'], .24, .77)), .15, 'stone')
    S.add(Ellipsoid(V(0, -1.75, 4.05), V(.46, .30, .52)), .17, 'stone')
    S.sub(Ellipsoid(V(0, -2.115, 4.50), V(.81, .13, .62)), .045)
    for side in (-1, 1):
        # Three structural ribs on each wing, buried deeply; readable as carving, not loose strips.
        for j in range(c['hood_ribs']):
            x = side * (.35 + .22 * j)
            S.add(Capsule(V(x * .55, -2.02, 4.03), V(x, -1.985, 4.85 + .06 * j), .045),
                  .04, 'stone')
    add_cobra_face(S, c['face_center'], c['face_scale'], cfg)
    # Sparse broad scutes down the frontal throat only (never a scale-noise carpet).
    for z in (4.05, 4.22, 4.39):
        S.sub(Ellipsoid(V(0, -1.96 - (z - 4.05) * .22, z), V(.28, .055, .028)), .018)
    return S


def throne_sculpt(cfg):
    from lib.sdf import Sculpt, V, Ellipsoid, RoundBox, Chain, Capsule
    c = cfg['throne']
    S = Sculpt(materials=('stone',), default_mat='stone')
    S.add(RoundBox(V(0, 1.20, 2.48), V(1.17, .26, 1.10), r=.095), 0, 'stone')
    S.add(Ellipsoid(V(0, 1.23, 3.28), V(c['hood_width'], .31, c['hood_height'])), .13, 'stone')
    # Thick outer rolled rim is carved into the hood's front, with a quiet central relief field.
    S.sub(Ellipsoid(V(0, .877, 3.45), V(1.16, .115, .57)), .045)
    for side in (-1, 1):
        S.add(Capsule(V(side * 1.05, .902, 2.05), V(side * 1.08, .902, 3.38), .065),
              .04, 'stone')
        # Arms coil out of the back, sink into the retained seat and land on the top step.
        pts = [V(side * 1.12, 1.12, 1.46), V(side * 1.43, .65, 1.87),
               V(side * 1.43, .10, 1.92), V(side * 1.30, -.40, 1.84)]
        S.add(Chain(pts, [.26, .24, .23, .20], k=.065), .085, 'stone')
        pts = [V(side * 1.13, 1.12, 1.46), V(side * 1.52, .57, 1.12),
               V(side * 1.43, -.27, 1.06), V(side * 1.28, -.43, 1.36)]
        S.add(Chain(pts, [.24, .20, .19, .20], k=.06), .07, 'stone')
        add_cobra_face(S, (side * 1.30, -.43, 1.88), .69, cfg, eyes=False)
    # Raised intertwined serpent relief, embedded 3 cm into the front of the backrest.
    for side in (-1, 1):
        pts = []
        for t in np.linspace(0, 1, 34):
            pts.append(V(side * c['relief_width'] * math.sin(t * math.tau),
                         .909, 1.94 + 1.20 * t))
        S.add(Chain(pts, [.065] * len(pts), k=.022), .025, 'stone')
    add_cobra_face(S, c['face_center'], c['face_scale'], cfg)
    # A few eroded diagonal cuts on the rim; no added gilding or pale stone patches.
    for side in (-1, 1):
        S.sub(Capsule(V(side * 1.12, .91, 3.69), V(side * 1.23, 1.01, 3.90), .035), .018)
    return S
