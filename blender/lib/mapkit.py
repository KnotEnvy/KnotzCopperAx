"""Cartographer's relief-map kit (ui-flow r7): numpy noise / fields / low-poly prop batches / PNG writer.

Pure numpy except `Batch.to_object()` (lazy bpy import), so the terrain + paint passes can be previewed with Blender's bundled
python (no Blender process) and the scene assembled by blender/build_ui_map.py.

Map space = the 1600x900 SVG map units (x right, y DOWN). World space (Blender) = X = x - 800, Y = -(y - 450) / cos(TILT),
Z = height: an orthographic camera tilted TILT from straight down sees ground (x, y, 0) exactly at pixel (x, y), and a thing
of height z appears z*sin(TILT) pixels above its footprint - so every plaque / route / marker coordinate in map.js stays valid.
"""
import math
import zlib
import struct
import numpy as np

TILT = math.radians(38.0)
CT, ST = math.cos(TILT), math.sin(TILT)
W, H = 1600, 900


def to_world(x, y, z=0.0):
    return (x - 800.0, -(y - 450.0) / CT, z)


# ------------------------------------------------------------------------------------------------ PNG (no PIL in bundled py)
def save_png(path, rgb):
    """rgb: HxWx3 (or 4) uint8 array."""
    a = np.ascontiguousarray(rgb)
    h, w, c = a.shape
    raw = b''.join(b'\x00' + a[i].tobytes() for i in range(h))

    def chunk(t, d):
        c_ = struct.pack('>I', len(d)) + t + d
        return c_ + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if c == 4 else 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


# ------------------------------------------------------------------------------------------------ noise
_TABLES = {}


def _table(seed):
    if seed not in _TABLES:
        _TABLES[seed] = np.random.RandomState(seed).rand(256, 256).astype(np.float32)
    return _TABLES[seed]


def vnoise(x, y, seed=1):
    """Smooth value noise in [0,1], lattice period 256."""
    t = _table(seed)
    xi = np.floor(x).astype(np.int64); yi = np.floor(y).astype(np.int64)
    fx = (x - xi).astype(np.float32); fy = (y - yi).astype(np.float32)
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    x0 = xi & 255; x1 = (xi + 1) & 255; y0 = yi & 255; y1 = (yi + 1) & 255
    a = t[y0, x0]; b = t[y0, x1]; c = t[y1, x0]; d = t[y1, x1]
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy


def fbm(x, y, oct=5, seed=1, lac=2.0, gain=0.5):
    """x, y in lattice units (already divided by feature size). Returns ~[0,1] centred at .5."""
    s = np.zeros_like(x, dtype=np.float32); amp = 1.0; tot = 0.0
    for i in range(oct):
        s += amp * vnoise(x * lac ** i + i * 17.3, y * lac ** i - i * 9.1, seed + i * 13)
        tot += amp; amp *= gain
    return s / tot


def ridged(x, y, oct=5, seed=1, lac=2.0, gain=0.5):
    """Sharp-crested noise in [0,1] (1 on ridges)."""
    s = np.zeros_like(x, dtype=np.float32); amp = 1.0; tot = 0.0
    for i in range(oct):
        n = 1.0 - np.abs(2.0 * vnoise(x * lac ** i + i * 5.7, y * lac ** i + i * 3.3, seed + i * 7) - 1.0)
        s += amp * n * n; tot += amp; amp *= gain
    return s / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def seg_dist(X, Y, pts):
    """Distance from every grid point to a polyline (list of (x, y)); also returns the arc parameter 0..1 of the nearest point."""
    best = np.full(X.shape, 1e9, np.float32); par = np.zeros(X.shape, np.float32)
    lens = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    tot = sum(lens) or 1.0; acc = 0.0
    for i in range(len(pts) - 1):
        ax, ay = pts[i]; bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy + 1e-9
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
        d = np.hypot(X - (ax + dx * t), Y - (ay + dy * t))
        m = d < best
        best = np.where(m, d, best); par = np.where(m, (acc + t * lens[i]) / tot, par)
        acc += lens[i]
    return best, par


def catmull(pts, n=12):
    """Catmull-Rom spline through pts -> dense polyline."""
    P = [pts[0]] + list(pts) + [pts[-1]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(tuple(pts[-1]))
    return out


def resize(a, w, h):
    """Bilinear resize of a 2-D (or HxWxC) float array to (h, w)."""
    sh, sw = a.shape[:2]
    ys = (np.arange(h) + .5) * sh / h - .5; xs = (np.arange(w) + .5) * sw / w - .5
    y0 = np.clip(np.floor(ys).astype(int), 0, sh - 1); y1 = np.clip(y0 + 1, 0, sh - 1); fy = (ys - np.floor(ys)).clip(0, 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, sw - 1); x1 = np.clip(x0 + 1, 0, sw - 1); fx = (xs - np.floor(xs)).clip(0, 1)
    if a.ndim == 3:
        fy = fy[:, None, None]; fx = fx[None, :, None]
    else:
        fy = fy[:, None]; fx = fx[None, :]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bot * fy


def blur(a, r):
    """Cheap separable box blur x2 (approx gaussian), radius r px, 2-D or HxWxC."""
    if r < 1:
        return a
    k = int(r) * 2 + 1
    for ax in (0, 1):
        for _ in range(2):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)], mode='edge'), axis=ax, dtype=np.float64)
            sl = [slice(None)] * a.ndim
            hi = list(sl); lo = list(sl); hi[ax] = slice(k, None); lo[ax] = slice(0, -k)
            a = ((c[tuple(hi)] - c[tuple(lo)]) / k).astype(np.float32)
    return a


def srgb2lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ------------------------------------------------------------------------------------------------ low-poly prop batches
class Batch:
    """Accumulates coloured triangles/quads (world space). Colours are sRGB triples; converted to linear on export."""

    def __init__(self, seed=1):
        self.v = []; self.f = []; self.c = []; self.n = 0
        self.rs = np.random.RandomState(seed)

    def _add(self, verts, faces, col, jit=0.05):
        verts = np.asarray(verts, np.float32)
        col = np.asarray(col, np.float32)
        if col.ndim == 1:
            cj = np.clip(col + (self.rs.rand(3) - .5) * jit, 0, 1)
            cc = np.tile(cj, (len(verts), 1))
        else:
            cc = col
        self.v.append(verts); self.c.append(cc)
        self.f.append(np.asarray(faces, np.int64) + self.n)   # faces: list of tuples (tri or quad -> triangulated)
        self.n += len(verts)

    @staticmethod
    def _tri(faces):
        out = []
        for f in faces:
            if len(f) == 3:
                out.append(f)
            else:
                for i in range(1, len(f) - 1):
                    out.append((f[0], f[i], f[i + 1]))
        return out

    def add(self, verts, faces, col, jit=0.05):
        self._add(verts, self._tri(faces), col, jit)

    def box(self, c, s, yaw=0.0, col=(.8, .7, .5), jit=0.04, base=True):
        """c = (x, y, z) world; s = (sx, sy, sz) full size; z measured up from c.z if base else centred."""
        sx, sy, sz = s
        z0 = c[2] if base else c[2] - sz / 2
        pts = np.array([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], np.float32)
        pts = pts * np.array([sx / 2, sy / 2, 1], np.float32); pts[:, 2] *= sz
        co, si = math.cos(yaw), math.sin(yaw)
        v = np.stack([c[0] + pts[:, 0] * co - pts[:, 1] * si, c[1] + pts[:, 0] * si + pts[:, 1] * co, z0 + pts[:, 2]], 1)
        self.add(v, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col, jit)

    def gable(self, c, w, d, h, yaw=0.0, col=(.6, .3, .2), overhang=1.5, jit=0.04, ridge_x=True):
        """Gable roof sitting on top of a box footprint w x d, base at c.z, ridge along local x."""
        w2, d2 = w / 2 + overhang, d / 2 + overhang
        pts = np.array([[-w2, -d2, 0], [w2, -d2, 0], [w2, d2, 0], [-w2, d2, 0], [-w2, 0, h], [w2, 0, h]], np.float32)
        co, si = math.cos(yaw), math.sin(yaw)
        v = np.stack([c[0] + pts[:, 0] * co - pts[:, 1] * si, c[1] + pts[:, 0] * si + pts[:, 1] * co, c[2] + pts[:, 2]], 1)
        self.add(v, [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)], col, jit)

    def cone(self, c, r, h, n=7, col=(.4, .5, .3), yaw=0.0, rtop=0.0, jit=0.05, squash=1.0, cap=True):
        v = []; f = []
        for i in range(n):
            a = yaw + 2 * math.pi * i / n
            v.append((c[0] + math.cos(a) * r, c[1] + math.sin(a) * r * squash, c[2]))
        for i in range(n):
            a = yaw + 2 * math.pi * i / n
            v.append((c[0] + math.cos(a) * rtop, c[1] + math.sin(a) * rtop * squash, c[2] + h))
        for i in range(n):
            j = (i + 1) % n
            f.append((i, j, n + j, n + i))
        if rtop <= 1e-6:
            f = [(i, (i + 1) % n, n + i) for i in range(n)]
        if cap:
            f.append(tuple(reversed(range(n))))
        if rtop > 1e-6:
            f.append(tuple(range(n, 2 * n)))
        self.add(v, f, col, jit)

    def cyl(self, c, r, h, n=8, col=(.7, .6, .5), rtop=None, jit=0.04, squash=1.0):
        self.cone(c, r, h, n, col, 0.0, r if rtop is None else rtop, jit, squash)

    def ellipsoid(self, c, rx, ry, rz, col=(.4, .5, .3), nu=7, nv=5, jit=0.05, rot=0.0, noise=0.0):
        v = []; f = []
        for j in range(nv + 1):
            th = math.pi * j / nv
            for i in range(nu):
                ph = 2 * math.pi * i / nu + (j % 2) * math.pi / nu
                k = 1.0 + (self.rs.rand() - .5) * noise
                x, y, z = rx * math.sin(th) * math.cos(ph) * k, ry * math.sin(th) * math.sin(ph) * k, rz * math.cos(th) * k
                v.append((c[0] + x * math.cos(rot) - y * math.sin(rot), c[1] + x * math.sin(rot) + y * math.cos(rot), c[2] + z))
        for j in range(nv):
            for i in range(nu):
                a = j * nu + i; b = j * nu + (i + 1) % nu; c2 = (j + 1) * nu + (i + 1) % nu; d = (j + 1) * nu + i
                f.append((a, d, c2, b))
        self.add(v, f, col, jit)

    def tube(self, pts, radii, n=8, col=(.3, .5, .25), jit=0.03, colfn=None):
        """Swept tube along a 3-D polyline (world). radii: scalar or per-point."""
        pts = np.asarray(pts, np.float32); m = len(pts)
        radii = np.full(m, radii, np.float32) if np.isscalar(radii) else np.asarray(radii, np.float32)
        v = []; cols = []
        up = np.array([0, 0, 1], np.float32)
        for i in range(m):
            t = pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]; t /= (np.linalg.norm(t) + 1e-9)
            s = np.cross(t, up)
            if np.linalg.norm(s) < 1e-3:
                s = np.array([1, 0, 0], np.float32)
            s /= np.linalg.norm(s); u = np.cross(s, t)
            for k in range(n):
                a = 2 * math.pi * k / n
                v.append(pts[i] + (s * math.cos(a) + u * math.sin(a)) * radii[i])
                cols.append(colfn(i / (m - 1), k / n) if colfn else col)
        f = []
        for i in range(m - 1):
            for k in range(n):
                k2 = (k + 1) % n
                f.append((i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k))
        f.append(tuple(reversed(range(n)))); f.append(tuple(range((m - 1) * n, m * n)))
        self.add(np.array(v), f, np.array(cols, np.float32) if colfn else col, jit)

    # ---------------------------------------------------------------- export
    def arrays(self):
        if not self.v:
            return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int64), np.zeros((0, 3), np.float32)
        return np.concatenate(self.v), np.concatenate(self.f), np.concatenate(self.c)

    def to_object(self, name, material=None, smooth=False, collection=None, emission=None):
        import bpy
        v, f, c = self.arrays()
        me = bpy.data.meshes.new(name)
        me.vertices.add(len(v)); me.vertices.foreach_set('co', v.ravel())
        me.loops.add(len(f) * 3); me.loops.foreach_set('vertex_index', f.ravel())
        me.polygons.add(len(f))
        me.polygons.foreach_set('loop_start', np.arange(len(f), dtype=np.int32) * 3)
        me.polygons.foreach_set('loop_total', np.full(len(f), 3, np.int32))
        me.polygons.foreach_set('use_smooth', np.full(len(f), bool(smooth)))
        me.update(calc_edges=True)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        lin = srgb2lin(c)
        ca.data.foreach_set('color', np.concatenate([lin, np.ones((len(lin), 1), np.float32)], 1).ravel())
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if material is not None:
            ob.data.materials.append(material)
        return ob


def grid_mesh(name, Z, sx=1.0, collection=None, material=None, uv=True, yscale=1.0, x0=0.0, y0=0.0):
    """Heightfield Z[(H+1),(W+1)] as a smooth grid object. Vertex (i,j) at map (j*sx, i*sx) -> world (x-800, -(y-450)/CT)."""
    import bpy
    h1, w1 = Z.shape
    jj, ii = np.meshgrid(np.arange(w1, dtype=np.float32), np.arange(h1, dtype=np.float32))
    X = jj * sx; Y = ii * sx
    co = np.stack([X - 800.0, -(Y - 450.0) / CT, Z.astype(np.float32)], -1).reshape(-1, 3)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co)); me.vertices.foreach_set('co', co.ravel())
    qi, qj = np.meshgrid(np.arange(w1 - 1), np.arange(h1 - 1))
    a = (qj * w1 + qi).ravel(); b = a + 1; d = a + w1; c = d + 1
    quads = np.stack([a, b, c, d], 1).astype(np.int32)
    nq = len(quads)
    me.loops.add(nq * 4); me.loops.foreach_set('vertex_index', quads.ravel())
    me.polygons.add(nq)
    me.polygons.foreach_set('loop_start', np.arange(nq, dtype=np.int32) * 4)
    me.polygons.foreach_set('loop_total', np.full(nq, 4, np.int32))
    me.polygons.foreach_set('use_smooth', np.full(nq, True))
    me.update(calc_edges=True)
    if uv:
        layer = me.uv_layers.new(name='UVMap')
        u = (X / (w1 - 1) / sx).reshape(-1); vv = (1.0 - Y / ((h1 - 1) * sx)).reshape(-1)
        idx = quads.ravel()
        layer.data.foreach_set('uv', np.stack([u[idx], vv[idx]], 1).ravel().astype(np.float32))
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if material is not None:
        ob.data.materials.append(material)
    return ob
